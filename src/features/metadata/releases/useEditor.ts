import type { MetadataTarget } from "@/features/metadata/types";
import { t } from "@/shared/i18n/locale";
import { markRaw, reactive, toRefs } from "vue";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { LibraryAlbumSelection } from "@/features/library/types";
import type { EditableTrack, MetadataSaveResult } from "@/features/metadata/types";
import { TAG_FIELDS } from "@/features/metadata/draft";
import {
  assignTrack,
  buildAlbumPatches,
  createMatchRows,
  releaseId,
} from "@/features/metadata/releases/matching";
import type {
  AlbumField,
  CoverChoice,
  CoverData,
  MatchRow,
  ReleaseDetails,
  ReleaseSummary,
  SearchResults,
  TrackPatch,
} from "@/features/metadata/releases/types";
import { createLibraryApi } from "@/features/library/api";
import { createMetadataApi } from "@/features/metadata/api";
import { createTagSynchronization } from "@/features/metadata/synchronize";
import { createMetadataSave, metadataSaved } from "@/features/metadata/save";
import type { MetadataFileEditor } from "@/features/metadata/save";
import { usePlaybackSession } from "@/features/playback/session";

export type ReleaseEditorOptions = {
  loadAlbum: (album: LibraryAlbumSelection) => Promise<EditableTrack[]>;
  loadFiles?: (paths: string[]) => Promise<EditableTrack[]>;
  search: (artist: string, album: string, offset: number) => Promise<SearchResults>;
  release: (id: string) => Promise<ReleaseDetails>;
  covers: (id: string) => Promise<CoverChoice[]>;
  cover: (releaseId: string, coverId: string) => Promise<CoverData>;
  save: (
    patches: TrackPatch[],
    cover: CoverData | null,
    progress: (result: MetadataSaveResult) => void,
    operationId?: string,
  ) => Promise<MetadataSaveResult[]>;
  editFiles: MetadataFileEditor;
  synchronize: (ids: MetadataTarget[]) => Promise<void>;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createReleaseEditor(options: ReleaseEditorOptions) {
  const saving = createMetadataSave({ ...options, notifyResult: true });
  const state = reactive({
    ...toRefs(saving.state),
    open: false,
    loading: false,
    searching: false,
    hasSearched: false,
    loadingRelease: false,
    loadingCover: false,
    dirty: false,
    coverError: "",
    artist: "",
    album: "",
    directId: "",
    tracks: [] as EditableTrack[],
    candidates: [] as ReleaseSummary[],
    count: 0,
    offset: 0,
    selected: null as ReleaseDetails | null,
    rows: [] as MatchRow[],
    fields: [] as AlbumField[],
    included: [] as MetadataTarget[],
    covers: [] as CoverChoice[],
    coverId: "",
    cover: null as CoverData | null,
    writeCover: false,
    confirmDiscard: false,
    confirmSave: false,
    patches: [] as TrackPatch[],
  });
  function reportError(event: string, error: unknown, cover = false) {
    const text = message(error);
    if (cover) state.coverError = text;
    else state.error = text;
    logger.error("metadata", event, error);
    const failures: Record<string, string> = {
      release_editor_load_failed: t("读取本地标签失败，请查看日志"),
      release_search_failed: t("搜索发行版本失败，请查看日志"),
      release_load_failed: t("读取发行版本失败，请查看日志"),
      release_covers_failed: t("读取封面列表失败，请查看日志"),
      release_cover_failed: t("读取封面失败，请查看日志"),
    };
    notify({ type: "error", message: failures[event] ?? text, key: "tags-release" });
  }
  let lifetime = 0;
  let searchGeneration = 0;
  let releaseGeneration = 0;
  let coverGeneration = 0;
  let discardAction: (() => void) | null = null;
  let savedCover: CoverData | null = null;
  let searched = { artist: "", album: "" };
  const busy = () => state.loading || state.saving || state.confirmSave || state.confirmDiscard;
  function edited() {
    state.dirty = true;
    state.error = "";
    state.results = [];
  }
  async function open(album: LibraryAlbumSelection, paths?: string[]) {
    if (state.open || state.saving) return;
    const generation = ++lifetime;
    saving.reset();
    Object.assign(state, {
      open: true,
      loading: true,
      searching: false,
      hasSearched: false,
      loadingRelease: false,
      loadingCover: false,
      saving: false,
      dirty: false,
      error: "",
      coverError: "",
      artist: album.albumArtist ?? "",
      album: album.album ?? "",
      directId: "",
      tracks: [],
      candidates: [],
      count: 0,
      offset: 0,
      selected: null,
      rows: [],
      fields: [],
      included: [],
      covers: [],
      coverId: "",
      cover: null,
      writeCover: false,
      confirmDiscard: false,
      confirmSave: false,
      patches: [],
      results: [],
      completed: 0,
      total: 0,
    });
    try {
      const tracks =
        paths && options.loadFiles
          ? await options.loadFiles(paths)
          : await options.loadAlbum(album);
      if (generation !== lifetime) return;
      if (!tracks.length) throw new Error(t("专辑没有可编辑的曲目。"));
      state.tracks = tracks;
      if (paths) {
        state.artist = tracks[0]?.track.albumArtist ?? tracks[0]?.track.artist ?? "";
        state.album = tracks[0]?.track.album ?? "";
      }
      const unavailable = tracks.filter(
        ({ issue, writableFields }) => issue || !writableFields.length,
      );
      for (const { track, issue } of unavailable) {
        logger.warn("metadata", "editable_track_unavailable", issue ?? "不支持写入", {
          trackId: track.id,
          path: track.path,
        });
      }
      if (unavailable.length)
        notify({
          type: "warning",
          message: t("{count} 首曲目的标签读取失败或不支持写入。", { count: unavailable.length }),
        });
    } catch (error) {
      if (generation === lifetime) reportError("release_editor_load_failed", error);
    } finally {
      if (generation === lifetime) state.loading = false;
    }
  }
  function close() {
    if (state.saving) return;
    ++lifetime;
    ++searchGeneration;
    ++releaseGeneration;
    ++coverGeneration;
    state.open = false;
    state.confirmSave = false;
    state.confirmDiscard = false;
    state.cover = null;
    savedCover = null;
    discardAction = null;
  }
  function requestClose() {
    if (state.saving) return;
    state.confirmSave = false;
    discardOr(close);
  }
  function discardOr(action: () => void) {
    if (state.saving || state.confirmDiscard) return;
    if (state.dirty) {
      discardAction = action;
      state.confirmDiscard = true;
    } else action();
  }
  function confirmDiscard() {
    const action = discardAction;
    discardAction = null;
    state.confirmDiscard = false;
    action?.();
  }
  function search() {
    if (busy() || state.searching) return;
    searched = { artist: state.artist, album: state.album };
    return searchPage(0);
  }
  function loadMore() {
    return searchPage(state.offset + 25);
  }
  async function searchPage(page: number) {
    if (busy() || state.searching) return;
    const generation = ++searchGeneration;
    state.searching = true;
    state.error = "";
    try {
      const results = await options.search(searched.artist, searched.album, page);
      if (generation !== searchGeneration || !state.open) return;
      state.candidates = page > 0 ? [...state.candidates, ...results.releases] : results.releases;
      state.count = results.count;
      state.offset = results.offset;
      state.hasSearched = true;
    } catch (error) {
      if (generation === searchGeneration) reportError("release_search_failed", error);
    } finally {
      if (generation === searchGeneration) state.searching = false;
    }
  }
  async function loadRelease(id: string) {
    const generation = ++releaseGeneration;
    ++coverGeneration;
    state.loadingRelease = true;
    state.loadingCover = false;
    state.error = "";
    try {
      const release = await options.release(id);
      if (generation !== releaseGeneration || !state.open) return;
      state.selected = release;
      state.rows = createMatchRows(release, state.tracks);
      if (release.summary.trackCount !== state.tracks.length) {
        const text = `来源 ${release.summary.trackCount} 首 / 本地 ${state.tracks.length} 首，曲目数量不一致，请核对对应关系。`;
        logger.warn("metadata", "release_track_count_mismatch", text, {
          context: release.summary.id,
        });
        notify({
          type: "warning",
          message: t("来源 {sourceCount} 首 / 本地 {count} 首，曲目数量不一致，请核对对应关系。", {
            sourceCount: release.summary.trackCount,
            count: state.tracks.length,
          }),
        });
      }
      state.fields = TAG_FIELDS.flatMap(({ key }) =>
        state.rows.some((row) => row.values[key] !== undefined) ? [key] : [],
      );
      state.included = state.tracks.flatMap(({ issue, track }) => (issue ? [] : [track.id]));
      state.covers = [];
      state.coverId = "";
      state.cover = null;
      state.writeCover = false;
      state.coverError = "";
      state.dirty = false;
      state.results = [];
      state.patches = [];
      void loadCovers(release.summary.id, generation);
    } catch (error) {
      if (generation === releaseGeneration) reportError("release_load_failed", error);
    } finally {
      if (generation === releaseGeneration) state.loadingRelease = false;
    }
  }
  function selectRelease(id: string) {
    if (busy()) return;
    discardOr(() => void loadRelease(id));
  }
  function loadDirect() {
    const id = releaseId(state.directId);
    if (!id) {
      reportError(
        "release_id_invalid",
        new Error(t("请输入 MusicBrainz 发行版本链接或有效 ID（不是 release-group）。")),
      );
      return;
    }
    selectRelease(id);
  }
  async function loadCovers(id: string, generation: number) {
    state.loadingCover = true;
    try {
      const covers = await options.covers(id);
      if (generation !== releaseGeneration || !state.open) return;
      state.covers = covers;
      if (covers[0]) await loadCover(covers[0].id);
      else {
        state.coverError = t("该发行版本没有正面封面，保留本地封面。");
        logger.info("metadata", "release_cover_missing", { context: id });
      }
    } catch (error) {
      if (generation === releaseGeneration) reportError("release_covers_failed", error, true);
    } finally {
      if (generation === releaseGeneration) state.loadingCover = false;
    }
  }
  function selectCover(id: string) {
    if (busy() || state.loadingRelease) return;
    edited();
    return loadCover(id);
  }
  async function loadCover(id: string) {
    const release = state.selected;
    if (!release) return;
    const generation = ++coverGeneration;
    const selectedGeneration = releaseGeneration;
    state.coverId = id;
    state.cover = null;
    state.coverError = "";
    state.loadingCover = true;
    try {
      const data = await options.cover(release.summary.id, id);
      if (generation !== coverGeneration || selectedGeneration !== releaseGeneration || !state.open)
        return;
      state.cover = markRaw(data);
    } catch (error) {
      if (generation === coverGeneration && selectedGeneration === releaseGeneration) {
        reportError("release_cover_failed", error, true);
        state.writeCover = false;
      }
    } finally {
      if (generation === coverGeneration && selectedGeneration === releaseGeneration)
        state.loadingCover = false;
    }
  }
  function move(trackId: MetadataTarget, target: number | null) {
    if (busy() || state.loadingRelease || !state.tracks.some(({ track }) => track.id === trackId))
      return;
    assignTrack(state.rows, trackId, target);
    edited();
  }
  function setValue(index: number, field: AlbumField, value: string | undefined) {
    if (busy() || state.loadingRelease) return;
    const row = state.rows[index];
    if (row?.source) {
      row.values[field] = value;
      edited();
    }
  }
  function setSharedValue(field: AlbumField, value: string | undefined) {
    if (busy() || state.loadingRelease) return;
    for (const row of state.rows) {
      if (row.source) row.values[field] = value;
    }
    edited();
  }
  function toggleField(field: AlbumField) {
    if (busy() || state.loadingRelease) return;
    state.fields = state.fields.includes(field)
      ? state.fields.filter((key) => key !== field)
      : [...state.fields, field];
    edited();
  }
  function toggleTrack(id: MetadataTarget) {
    if (busy()) return;
    state.included = state.included.includes(id)
      ? state.included.filter((key) => key !== id)
      : [...state.included, id];
    edited();
  }
  function toggleCover() {
    if (busy() || !state.cover) return;
    state.writeCover = !state.writeCover;
    edited();
  }
  function confirmPatches() {
    if (!state.patches.length) {
      reportError("release_changes_empty", new Error(t("没有需要写入的改动。")));
      return;
    }
    state.confirmSave = true;
  }
  function prepareSave() {
    if (busy() || state.loadingRelease) return;
    state.error = "";
    try {
      if (state.writeCover && (!state.cover || state.loadingCover))
        throw new Error(t("请等待封面下载完成，或取消封面覆盖。"));
      state.patches = buildAlbumPatches(
        state.rows,
        state.tracks,
        state.fields,
        state.included,
        state.writeCover,
      );
      const unsupported = state.rows.filter((row) => {
        if (!row.source || row.trackId === null || !state.included.includes(row.trackId))
          return false;
        const local = state.tracks.find(({ track }) => track.id === row.trackId);
        const fields = state.fields.filter(
          (field) => row.values[field] !== undefined && !local?.writableFields.includes(field),
        );
        if (!fields.length) return false;
        logger.warn("metadata", "release_fields_unsupported", "不支持写入", {
          trackId: row.trackId,
          context: fields.join(","),
        });
        return true;
      });
      if (unsupported.length)
        notify({
          type: "warning",
          message: t("{count} 首曲目不支持写入部分所选字段，请核对所选字段。", {
            count: unsupported.length,
          }),
        });
      savedCover = state.writeCover ? state.cover : null;
      confirmPatches();
    } catch (error) {
      reportError("release_validation_failed", error);
    }
  }
  async function save() {
    if (!state.confirmSave || state.saving) return;
    const cover = savedCover;
    close();
    const patches = state.patches.map((patch) => ({
      ...patch,
      changes: patch.changes.map((change) => ({ ...change })),
    }));
    const targets = patches.map(({ trackId }) => ({
      trackId,
      path: state.tracks.find(({ track }) => track.id === trackId)?.track.path ?? "",
    }));
    const results = await saving.run({
      targets,
      writeTrackIds: patches.map(({ trackId }) => trackId),
      execute: (progress, operationId) => options.save(patches, cover, progress, operationId),
    });
    const updated = new Set(
      results.flatMap((result) => (metadataSaved(result) ? [result.trackId] : [])),
    );
    for (const patch of patches) {
      if (!updated.has(patch.trackId)) continue;
      const local = state.tracks.find(({ track }) => track.id === patch.trackId);
      if (!local) continue;
      for (const change of patch.changes) {
        const field = TAG_FIELDS.find(({ key }) => key === change.field);
        if (!field) continue;
        const value =
          change.value !== null && field.type === "number" ? Number(change.value) : change.value;
        if (field.key in local.track) Object.assign(local.track, { [field.key]: value });
        else {
          local.values ??= {};
          if (change.value === null) delete local.values[field.key];
          else local.values[field.key] = change.value;
        }
      }
    }
    state.dirty = state.results.some((result) => !metadataSaved(result));
  }
  return {
    state,
    open,
    openFiles: (paths: string[]) => open({ albumArtist: null, album: null }, paths),
    close,
    requestClose,
    confirmDiscard,
    search,
    loadMore,
    selectRelease,
    loadDirect,
    selectCover,
    move,
    setValue,
    setSharedValue,
    toggleField,
    toggleTrack,
    toggleCover,
    prepareSave,
    save,
  };
}
let shared: ReturnType<typeof createReleaseEditor> | null = null;
export function useReleaseEditor() {
  if (shared) return shared;
  const session = usePlaybackSession();
  const api = createMetadataApi(invoke);
  const library = createLibraryApi(invoke);
  const synchronize = createTagSynchronization(session, invoke);
  shared = createReleaseEditor({
    loadAlbum: async (album) => {
      const tracks = await library.listAlbumTracks(album);
      return api.editableTracks(tracks.map((track) => track.id));
    },
    loadFiles: api.editableTracks,
    search: api.searchReleases,
    release: api.release,
    covers: api.covers,
    cover: api.cover,
    save: (patches, cover, progress, operationId) => {
      const onProgress = new Channel<MetadataSaveResult>();
      onProgress.onmessage = progress;
      return api.saveRelease(patches, cover, onProgress, operationId);
    },
    editFiles: session.withMetadataEditing,
    synchronize: synchronize.artwork,
  });
  return shared;
}

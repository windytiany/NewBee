import { toRefs } from "vue";
import { createReleaseState } from "@/features/metadata/releases/state";
import { createReleaseSearch } from "@/features/metadata/releases/search";
import { createReleaseArtwork } from "@/features/metadata/releases/artwork";
import { createReleaseSelection } from "@/features/metadata/releases/selection";
import { createReleaseSave } from "@/features/metadata/releases/save";
import { t } from "@/shared/i18n/locale";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { runWriteTask } from "@/features/tasks/queue";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { LibraryAlbumSelection } from "@/features/library/types";
import type { EditableTrack, MetadataSaveResult } from "@/features/metadata/types";
import { assignTrack, releaseId } from "@/features/metadata/releases/matching";
import type {
  AlbumField,
  CoverChoice,
  CoverData,
  ReleaseDetails,
  SearchResults,
  TrackPatch,
} from "@/features/metadata/releases/types";
import { createLibraryApi } from "@/features/library/api";
import { createMetadataApi } from "@/features/metadata/api";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { createMetadataSave } from "@/features/metadata/save";
import type { MetadataFileEditor } from "@/features/metadata/save";
import { usePlaybackSession } from "@/features/playback/session";

export type ReleaseEditorOptions = {
  schedule?: typeof runWriteTask;
  loadAlbum: (album: LibraryAlbumSelection) => Promise<EditableTrack[]>;
  loadTracks: (trackIds: number[]) => Promise<EditableTrack[]>;
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
  synchronize: (ids: number[]) => Promise<void>;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createReleaseEditor(options: ReleaseEditorOptions) {
  let saving = createMetadataSave({ ...options, notifyResult: true });
  const state = createReleaseState(saving);
  function reportError(event: string, error: unknown, cover = false) {
    const text = message(error);
    if (cover) state.coverError = text;
    else state.error = text;
    logger.error("metadata", event, error);
    const failures: Record<string, string> = {
      release_editor_load_failed: t("读取本地标签失败"),
      release_search_failed: t("搜索发行版本失败"),
      release_load_failed: t("读取发行版本失败"),
      release_covers_failed: t("读取封面列表失败"),
      release_cover_failed: t("读取封面失败"),
    };
    notify({ type: "error", message: failures[event] ?? text, key: "tags-release" });
  }
  let lifetime = 0;
  let discardAction: (() => void) | null = null;
  const busy = () => state.loading || state.saving || state.confirmSave || state.confirmDiscard;
  const {
    search,
    loadMore,
    invalidate: invalidateSearch,
  } = createReleaseSearch(state, options.search, busy, reportError);
  const artwork = createReleaseArtwork(state, options, reportError);
  const selection = createReleaseSelection(state, options, artwork, reportError);
  let saveFlow = createReleaseSave(
    state,
    options,
    saving,
    busy,
    close,
    reportError,
    () => lifetime,
  );
  const prepareSave = () => saveFlow.prepareSave();
  const save = () => saveFlow.save();
  function edited() {
    state.dirty = true;
    state.error = "";
    state.results = [];
  }
  async function open(album: LibraryAlbumSelection, trackIds?: number[]) {
    if (state.open) return;
    const generation = ++lifetime;
    if (saving.state.saving) {
      saving = createMetadataSave({ ...options, notifyResult: true });
      Object.assign(state, toRefs(saving.state));
      saveFlow = createReleaseSave(
        state,
        options,
        saving,
        busy,
        close,
        reportError,
        () => lifetime,
      );
    }
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
      writeBlocked: false,
      patches: [],
      results: [],
      completed: 0,
      total: 0,
    });
    try {
      const tracks = trackIds
        ? await options.loadTracks([...new Set(trackIds)])
        : await options.loadAlbum(album);
      if (generation !== lifetime) return;
      if (!tracks.length) throw new Error(t("专辑没有可编辑的曲目。"));
      const ids = trackIds ? [...new Set(trackIds)] : tracks.map(({ track }) => track.id);
      if (
        tracks.length !== ids.length ||
        new Set(tracks.map(({ track }) => track.id)).size !== ids.length ||
        tracks.some(
          ({ track }) =>
            !Number.isSafeInteger(track.id) || track.id <= 0 || !ids.includes(track.id),
        )
      )
        throw new Error(t("返回的曲目与编辑目标不匹配。"));
      state.writeBlocked = tracks.some((track) => track.writePending);
      state.tracks = tracks;
      if (trackIds) {
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
    invalidateSearch();
    selection.invalidate();
    state.open = false;
    state.confirmSave = false;
    state.confirmDiscard = false;
    state.cover = null;
    saveFlow.reset();
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
  function selectRelease(id: string) {
    if (busy()) return;
    discardOr(() => void selection.loadRelease(id));
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
  function selectCover(id: string) {
    if (busy() || state.loadingRelease) return;
    edited();
    return artwork.loadCover(id);
  }
  function move(trackId: number, target: number | null) {
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
  function toggleTrack(id: number) {
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
  return {
    state,
    open,
    openTracks: (trackIds: number[]) => open({ albumArtist: null, album: null }, trackIds),
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
  const api = createMetadataApi();
  const library = createLibraryApi(invoke);
  const synchronize = createTrackSynchronization(session, invoke);
  shared = createReleaseEditor({
    loadAlbum: async (album) => {
      const tracks = await library.listAlbumTracks(album);
      return api.editableTracks(tracks.map((track) => track.id));
    },
    loadTracks: api.editableTracks,
    search: api.searchReleases,
    release: api.release,
    covers: api.covers,
    cover: api.cover,
    save: (patches, cover, progress, operationId) => {
      const onProgress = new Channel<MetadataSaveResult>();
      onProgress.onmessage = progress;
      return api.saveRelease(patches, cover, onProgress, operationId);
    },
    schedule: runWriteTask,
    editFiles: session.withMetadataEditing,
    synchronize: synchronize.refresh,
  });
  return shared;
}

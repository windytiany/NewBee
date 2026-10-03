import { markRaw, reactive } from "vue";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { LibraryAlbumSelection } from "@/library/selection";
import type { TrackDetails, TrackSummary } from "@/library/model";
import type { EditableTrack, MetadataSaveResult } from "@/metadata/model";
import { METADATA_FIELDS } from "@/metadata/model";
import { assignTrack, buildAlbumPatches, createMatchRows, releaseId } from "@/albumTags/model";
import type {
  AlbumField,
  CoverChoice,
  CoverData,
  MatchRow,
  ReleaseDetails,
  ReleaseSummary,
  SearchResults,
  TrackPatch,
} from "@/albumTags/model";
import { LIBRARY_CHANGED_EVENT } from "@/library/changes";
import { invalidateTrackArtworkCache } from "@/artwork/trackArtwork";
import { invalidateAlbumArtworkCache } from "@/artwork/albumArtwork";
import { usePlaybackSession } from "@/playback/session";
import { notify } from "@/notification/center";

export type AlbumTagOptions = {
  loadAlbum: (album: LibraryAlbumSelection) => Promise<EditableTrack[]>;
  search: (artist: string, album: string, offset: number) => Promise<SearchResults>;
  release: (id: string) => Promise<ReleaseDetails>;
  covers: (id: string) => Promise<CoverChoice[]>;
  cover: (releaseId: string, coverId: string) => Promise<CoverData>;
  save: (
    patches: TrackPatch[],
    cover: CoverData | null,
    progress: (result: MetadataSaveResult) => void,
  ) => Promise<MetadataSaveResult[]>;
  synchronize: (ids: number[]) => Promise<void>;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createAlbumTagEditor(options: AlbumTagOptions) {
  const state = reactive({
    open: false,
    loading: false,
    searching: false,
    hasSearched: false,
    loadingRelease: false,
    loadingCover: false,
    saving: false,
    dirty: false,
    error: "",
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
    included: [] as number[],
    covers: [] as CoverChoice[],
    coverId: "",
    cover: null as CoverData | null,
    writeCover: false,
    confirmDiscard: false,
    confirmSave: false,
    patches: [] as TrackPatch[],
    results: [] as MetadataSaveResult[],
    completed: 0,
    total: 0,
  });
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
  async function open(album: LibraryAlbumSelection) {
    if (state.open) return;
    const generation = ++lifetime;
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
      const tracks = await options.loadAlbum(album);
      if (generation !== lifetime) return;
      if (!tracks.length) throw new Error("专辑没有可编辑的曲目。");
      state.tracks = tracks;
    } catch (error) {
      if (generation === lifetime) state.error = message(error);
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
      if (generation === searchGeneration) state.error = message(error);
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
      state.fields = METADATA_FIELDS.flatMap(({ key }) =>
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
      if (generation === releaseGeneration) state.error = message(error);
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
      state.error = "请输入 MusicBrainz 发行版本链接或有效 ID（不是 release-group）。";
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
      else state.coverError = "该发行版本没有正面封面，保留本地封面。";
    } catch (error) {
      if (generation === releaseGeneration) state.coverError = message(error);
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
        state.coverError = message(error);
        state.writeCover = false;
      }
    } finally {
      if (generation === coverGeneration && selectedGeneration === releaseGeneration)
        state.loadingCover = false;
    }
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
    if (row) {
      row.values[field] = value;
      edited();
    }
  }
  function setSharedValue(field: AlbumField, value: string | undefined) {
    if (busy() || state.loadingRelease) return;
    for (const row of state.rows) row.values[field] = value;
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
  function confirmPatches() {
    if (!state.patches.length) {
      state.error = "没有需要写入的改动。";
      return;
    }
    state.confirmSave = true;
  }
  function prepareSave() {
    if (busy() || state.loadingRelease) return;
    state.error = "";
    try {
      if (state.writeCover && (!state.cover || state.loadingCover))
        throw new Error("请等待封面下载完成，或取消封面覆盖。");
      state.patches = buildAlbumPatches(
        state.rows,
        state.tracks,
        state.fields,
        state.included,
        state.writeCover,
      );
      savedCover = state.writeCover ? state.cover : null;
      confirmPatches();
    } catch (error) {
      state.error = message(error);
    }
  }
  function retryFailed() {
    if (busy() || state.loadingRelease) return;
    state.error = "";
    const failed = new Set(
      state.results.flatMap((result) => (result.databaseUpdated ? [] : [result.trackId])),
    );
    state.patches = state.patches.filter((patch) => failed.has(patch.trackId));
    confirmPatches();
  }
  async function save() {
    if (!state.confirmSave || state.saving) return;
    state.confirmSave = false;
    state.saving = true;
    state.error = "";
    const patches = state.patches.map((patch) => ({
      ...patch,
      changes: patch.changes.map((change) => ({ ...change })),
    }));
    const ids = new Set(patches.map((patch) => patch.trackId));
    const results = new Map(state.results.map((result) => [result.trackId, result]));
    const completed = new Set<number>();
    state.completed = 0;
    state.total = patches.length;
    let accepting = true;
    const progress = (result: MetadataSaveResult) => {
      if (!accepting || !ids.has(result.trackId)) return;
      results.set(result.trackId, result);
      completed.add(result.trackId);
      state.results = [...results.values()];
      state.completed = completed.size;
    };
    try {
      for (const result of await options.save(patches, savedCover, progress)) progress(result);
    } catch (error) {
      state.error = message(error);
    } finally {
      accepting = false;
      for (const patch of patches) {
        if (completed.has(patch.trackId)) continue;
        results.set(patch.trackId, {
          trackId: patch.trackId,
          path: state.tracks.find(({ track }) => track.id === patch.trackId)?.track.path ?? "",
          fileWritten: false,
          databaseUpdated: false,
          error: state.error || "保存未返回结果，请重试或重新扫描。",
        });
      }
      state.results = [...results.values()];
      const updated = [...ids].filter((id) => results.get(id)?.databaseUpdated);
      for (const patch of patches) {
        if (!updated.includes(patch.trackId)) continue;
        const local = state.tracks.find(({ track }) => track.id === patch.trackId);
        if (!local) continue;
        for (const change of patch.changes) {
          const field = METADATA_FIELDS.find(({ key }) => key === change.field);
          if (!field) continue;
          const value =
            change.value !== null && field.type === "number" ? Number(change.value) : change.value;
          Object.assign(local.track, { [change.field]: value });
        }
      }
      if (updated.length) {
        try {
          await options.synchronize(updated);
        } catch (error) {
          state.error = `文件已保存，但界面同步失败：${message(error)}`;
        }
      }
      state.saving = false;
      state.dirty = state.results.some((result) => !result.databaseUpdated);
      if (!state.dirty && !state.error) close();
    }
  }
  return {
    state,
    open,
    close,
    requestClose,
    confirmDiscard,
    search,
    loadMore,
    selectRelease,
    loadDirect,
    selectCover,
    retryCovers: () => {
      if (state.selected && !busy()) void loadCovers(state.selected.summary.id, releaseGeneration);
    },
    move,
    setValue,
    setSharedValue,
    toggleField,
    toggleTrack,
    toggleCover,
    prepareSave,
    retryFailed,
    save,
  };
}
let shared: ReturnType<typeof createAlbumTagEditor> | null = null;
export function useAlbumTagEditor() {
  if (shared) return shared;
  const session = usePlaybackSession();
  shared = createAlbumTagEditor({
    loadAlbum: async (album) => {
      const tracks = await invoke<TrackSummary[]>("list_album_tracks", album);
      return invoke("get_editable_tracks", { trackIds: tracks.map((track) => track.id) });
    },
    search: (artist, album, offset) => invoke("search_album_releases", { artist, album, offset }),
    release: (releaseId) => invoke("get_album_release", { releaseId }),
    covers: (releaseId) => invoke("get_release_covers", { releaseId }),
    cover: (releaseId, coverId) => invoke("get_release_cover", { releaseId, coverId }),
    save: (patches, cover, progress) =>
      session.withMetadataEditing(
        patches.map((patch) => patch.trackId),
        async () => {
          const onProgress = new Channel<MetadataSaveResult>();
          onProgress.onmessage = progress;
          const results = await invoke<MetadataSaveResult[]>("save_album_tags", {
            patches,
            cover,
            onProgress,
          });
          const failed = results.filter((result) => !result.databaseUpdated).length;
          notify({
            type: failed ? "warning" : "success",
            message: `专辑标签保存：${results.length - failed} 首成功，${failed} 首失败。`,
          });
          return results;
        },
      ),
    synchronize: async (ids) => {
      invalidateTrackArtworkCache(ids);
      invalidateAlbumArtworkCache();
      globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT));
      const tracks = await Promise.all(
        ids.map((trackId) => invoke<TrackDetails | null>("get_track", { trackId })),
      );
      session.updateTrackMetadata(tracks.filter((track): track is TrackDetails => track !== null));
    },
  });
  return shared;
}

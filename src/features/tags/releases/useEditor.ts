import { markRaw, reactive, toRefs } from "vue";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { LibraryAlbumSelection } from "@/features/library/types";
import type { EditableTrack, TagSaveResult } from "@/features/tags/types";
import { TAG_FIELDS } from "@/features/tags/draft";
import {
  assignTrack,
  buildAlbumPatches,
  createMatchRows,
  releaseId,
} from "@/features/tags/releases/matching";
import type {
  AlbumField,
  CoverChoice,
  CoverData,
  MatchRow,
  ReleaseDetails,
  ReleaseSummary,
  SearchResults,
  TrackPatch,
} from "@/features/tags/releases/types";
import { createLibraryApi } from "@/features/library/api";
import { createTagsApi } from "@/features/tags/api";
import { createTagSynchronization } from "@/features/tags/synchronize";
import { createMetadataSave } from "@/features/tags/save";
import type { MetadataFileEditor } from "@/features/tags/save";
import { usePlaybackSession } from "@/features/playback/session";

export type ReleaseEditorOptions = {
  loadAlbum: (album: LibraryAlbumSelection) => Promise<EditableTrack[]>;
  search: (artist: string, album: string, offset: number) => Promise<SearchResults>;
  release: (id: string) => Promise<ReleaseDetails>;
  covers: (id: string) => Promise<CoverChoice[]>;
  cover: (releaseId: string, coverId: string) => Promise<CoverData>;
  save: (
    patches: TrackPatch[],
    cover: CoverData | null,
    progress: (result: TagSaveResult) => void,
    operationId?: string,
  ) => Promise<TagSaveResult[]>;
  editFiles: MetadataFileEditor;
  synchronize: (ids: number[]) => Promise<void>;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createReleaseEditor(options: ReleaseEditorOptions) {
  const saving = createMetadataSave(options);
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
    included: [] as number[],
    covers: [] as CoverChoice[],
    coverId: "",
    cover: null as CoverData | null,
    writeCover: false,
    confirmDiscard: false,
    confirmSave: false,
    patches: [] as TrackPatch[],
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
      execute: (progress, operationId) => options.save(patches, savedCover, progress, operationId),
    });
    const updated = new Set(
      results.flatMap((result) => (result.databaseUpdated ? [result.trackId] : [])),
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
        Object.assign(local.track, { [change.field]: value });
      }
    }
    const error = [state.error, state.synchronizationError].filter(Boolean).join("\n");
    state.dirty = state.results.some((result) => !result.databaseUpdated);
    if (!state.dirty && !error) close();
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
    retrySynchronization: async () => {
      await saving.retrySynchronization();
      if (!state.dirty && !state.error && !state.synchronizationError) close();
    },
    save,
  };
}
let shared: ReturnType<typeof createReleaseEditor> | null = null;
export function useReleaseEditor() {
  if (shared) return shared;
  const session = usePlaybackSession();
  const api = createTagsApi(invoke);
  const library = createLibraryApi(invoke);
  const synchronize = createTagSynchronization(session, invoke);
  shared = createReleaseEditor({
    loadAlbum: async (album) => {
      const tracks = await library.listAlbumTracks(album);
      return api.editableTracks(tracks.map((track) => track.id));
    },
    search: api.searchReleases,
    release: api.release,
    covers: api.covers,
    cover: api.cover,
    save: (patches, cover, progress, operationId) => {
      const onProgress = new Channel<TagSaveResult>();
      onProgress.onmessage = progress;
      return api.saveRelease(patches, cover, onProgress, operationId);
    },
    editFiles: session.withMetadataEditing,
    synchronize: synchronize.artwork,
  });
  return shared;
}

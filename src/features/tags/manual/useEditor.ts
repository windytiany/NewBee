import { Channel, invoke } from "@tauri-apps/api/core";
import { reactive, toRefs } from "vue";
import type { LibraryAlbumSelection } from "@/features/library/types";
import { createLibraryApi } from "@/features/library/api";
import { createTagsApi } from "@/features/tags/api";
import { createTagSynchronization } from "@/features/tags/synchronize";
import { createMetadataSave } from "@/features/tags/save";
import type { MetadataFileEditor } from "@/features/tags/save";
import { usePlaybackSession } from "@/features/playback/session";
import { buildTagChanges, createTagDraft } from "@/features/tags/draft";
import type {
  DraftField,
  EditableTrack,
  EditMode,
  LyricsMarkAction,
  TagChange,
  TagSaveResult,
} from "@/features/tags/types";

export type TagEditorOptions = {
  loadTracks: (trackIds: number[]) => Promise<EditableTrack[]>;
  loadAlbum: (album: LibraryAlbumSelection) => Promise<number[]>;
  save: (
    trackIds: number[],
    changes: TagChange[],
    progress: (result: TagSaveResult) => void,
    lyricsAction: LyricsMarkAction,
    operationId?: string,
  ) => Promise<TagSaveResult[]>;
  editFiles: MetadataFileEditor;
  synchronize: (trackIds: number[]) => Promise<void>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createTagEditor(options: TagEditorOptions) {
  const saving = createMetadataSave(options);
  const state = reactive({
    ...toRefs(saving.state),
    open: false,
    mode: "tracks" as EditMode,
    loading: false,
    tracks: [] as EditableTrack[],
    draft: [] as DraftField[],
    dirty: false,
    lyricsAction: "keep" as LyricsMarkAction,
    confirmDiscard: false,
  });
  let loadGeneration = 0;
  let pendingChanges: TagChange[] = [];
  let pendingTrackIds: number[] = [];
  let pendingLyricsAction: LyricsMarkAction = "keep";

  async function open(loadIds: () => Promise<number[]>, mode: EditMode) {
    if (state.open) return;
    const generation = ++loadGeneration;
    saving.reset();
    Object.assign(state, {
      open: true,
      mode,
      loading: true,
      saving: false,
      tracks: [],
      draft: [],
      error: "",
      dirty: false,
      lyricsAction: "keep",
      confirmDiscard: false,
      results: [],
      completed: 0,
      total: 0,
    });
    try {
      const ids = [...new Set(await loadIds())];
      if (ids.length === 0) throw new Error("没有可编辑的曲目。");
      const tracks = await options.loadTracks(ids);
      if (!state.open || generation !== loadGeneration) return;
      if (
        tracks.length !== ids.length ||
        new Set(tracks.map(({ track }) => track.id)).size !== ids.length ||
        tracks.some(({ track }) => !ids.includes(track.id))
      ) {
        throw new Error("返回的曲目与编辑目标不匹配。");
      }
      state.tracks = tracks;
      state.draft = createTagDraft(tracks, mode);
    } catch (error) {
      if (state.open && generation === loadGeneration) state.error = errorMessage(error);
    } finally {
      if (generation === loadGeneration) state.loading = false;
    }
  }

  function close() {
    if (state.saving) return;
    ++loadGeneration;
    state.open = false;
    state.confirmDiscard = false;
  }

  function requestClose() {
    if (state.saving) return;
    if (state.dirty) state.confirmDiscard = true;
    else close();
  }

  function changeField(field: DraftField, value: string) {
    if (state.saving || !field.writable) return;
    field.value = value;
    field.mixed = false;
    if (field.key === "lyrics" && value.trim() && state.lyricsAction === "mark") {
      state.lyricsAction = "keep";
    }
    edited();
  }

  function changeLyricsAction(action: LyricsMarkAction) {
    if (state.loading || state.saving) return;
    state.lyricsAction = action;
    if (action === "mark") {
      const lyrics = state.draft.find((field) => field.key === "lyrics");
      if (lyrics) lyrics.value = "";
    }
    edited();
  }

  function edited() {
    state.dirty = true;
    state.error = "";
    state.results = [];
  }

  function prepareTargetSave(trackIds: number[]) {
    if (state.loading || state.saving) return;
    state.error = "";
    try {
      pendingLyricsAction = state.lyricsAction;
      pendingChanges = buildTagChanges(state.draft, state.tracks, {
        changedOnly: pendingLyricsAction !== "keep",
        allowEmpty: pendingLyricsAction !== "keep",
      });
      if (pendingLyricsAction === "mark")
        pendingChanges = pendingChanges.filter(({ field }) => field !== "lyrics");
      pendingTrackIds = trackIds;
      if (pendingTrackIds.length === 0) return;
      void save();
    } catch (error) {
      state.error = errorMessage(error);
    }
  }

  async function save() {
    if (state.saving || pendingTrackIds.length === 0) return;
    const ids = [...pendingTrackIds];
    const changes = pendingChanges.map((change) => ({ ...change }));
    const action = pendingLyricsAction;
    const targets = state.tracks.flatMap(({ track }) =>
      ids.includes(track.id) ? [{ trackId: track.id, path: track.path }] : [],
    );
    const writeIds = state.tracks.flatMap(({ track }) => {
      if (!ids.includes(track.id)) return [];
      if (changes.length || action === "mark") return [track.id];
      return [];
    });
    await saving.run({
      targets,
      writeTrackIds: writeIds,
      execute: (progress, operationId) => options.save(ids, changes, progress, action, operationId),
    });
    const failed = state.results.filter((result) => !result.databaseUpdated).length;
    const error = [state.error, state.synchronizationError].filter(Boolean).join("\n");
    state.dirty = failed > 0;
    if (!state.dirty && !error) state.open = false;
  }

  return {
    state,
    openTracks: (ids: readonly number[]) => open(() => Promise.resolve([...ids]), "tracks"),
    openAlbum: (album: LibraryAlbumSelection) => open(() => options.loadAlbum(album), "album"),
    requestClose,
    close,
    changeField,
    changeLyricsAction,
    edited,
    save,
    retrySynchronization: async () => {
      await saving.retrySynchronization();
      if (!state.dirty && !state.error && !state.synchronizationError) close();
    },
    prepareSave: () => prepareTargetSave(state.tracks.map(({ track }) => track.id)),
    retryFailed: () =>
      prepareTargetSave(
        state.results.flatMap((result) => (result.databaseUpdated ? [] : [result.trackId])),
      ),
  };
}

let sharedEditor: ReturnType<typeof createTagEditor> | null = null;
export function useTagEditor() {
  if (sharedEditor) return sharedEditor;
  const session = usePlaybackSession();
  const api = createTagsApi(invoke);
  const library = createLibraryApi(invoke);
  const synchronize = createTagSynchronization(session, invoke);
  sharedEditor = createTagEditor({
    loadTracks: api.editableTracks,
    loadAlbum: async (album) => (await library.listAlbumTracks(album)).map((track) => track.id),
    save: (trackIds, changes, progress, lyricsAction, operationId) => {
      const onProgress = new Channel<TagSaveResult>();
      onProgress.onmessage = progress;
      return api.saveMetadata(trackIds, changes, onProgress, lyricsAction, operationId);
    },
    editFiles: session.withMetadataEditing,
    synchronize: synchronize.tracks,
  });
  return sharedEditor;
}

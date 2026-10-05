import { Channel, invoke } from "@tauri-apps/api/core";
import { reactive } from "vue";
import type { LibraryAlbumSelection } from "@/features/library/types";
import { createLibraryApi } from "@/features/library/api";
import { createTagsApi } from "@/features/tags/api";
import { createTagSynchronization } from "@/features/tags/synchronize";
import { notify } from "@/shared/notifications/center";
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
  ) => Promise<TagSaveResult[]>;
  synchronize: (trackIds: number[]) => Promise<void>;
  notify: typeof notify;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createTagEditor(options: TagEditorOptions) {
  const state = reactive({
    open: false,
    mode: "tracks" as EditMode,
    loading: false,
    saving: false,
    tracks: [] as EditableTrack[],
    draft: [] as DraftField[],
    error: "",
    dirty: false,
    lyricsAction: "keep" as LyricsMarkAction,
    confirmDiscard: false,
    results: [] as TagSaveResult[],
    completed: 0,
    total: 0,
  });
  let loadGeneration = 0;
  let saveGeneration = 0;
  let pendingChanges: TagChange[] = [];
  let pendingTrackIds: number[] = [];
  let pendingLyricsAction: LyricsMarkAction = "keep";

  async function open(loadIds: () => Promise<number[]>, mode: EditMode) {
    if (state.open) return;
    const generation = ++loadGeneration;
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
    state.saving = true;
    state.completed = 0;
    state.total = ids.length;
    const generation = ++saveGeneration;
    let acceptingProgress = true;
    const completedIds = new Set<number>();
    const previous = new Map(state.results.map((result) => [result.trackId, result]));
    const progress = (result: TagSaveResult) => {
      if (!acceptingProgress || generation !== saveGeneration || !ids.includes(result.trackId))
        return;
      previous.set(result.trackId, result);
      completedIds.add(result.trackId);
      state.results = [...previous.values()];
      state.completed = completedIds.size;
    };
    try {
      const results = await options.save(ids, pendingChanges, progress, pendingLyricsAction);
      acceptingProgress = false;
      for (const result of results) previous.set(result.trackId, result);
      state.results = [...previous.values()];
      state.completed = ids.length;
      const updated = results.flatMap((result) => (result.databaseUpdated ? [result.trackId] : []));
      if (updated.length > 0) {
        try {
          await options.synchronize(updated);
        } catch (error) {
          state.error = `元数据已保存，但界面刷新失败：${errorMessage(error)}`;
        }
      }
      const failed = state.results.filter((result) => !result.databaseUpdated).length;
      options.notify({
        type: failed > 0 || state.error ? "warning" : "success",
        message: saveMessage(
          state.tracks.length,
          state.results.length - failed,
          failed,
          state.error,
        ),
        key: failed > 0 ? "metadata-save" : undefined,
      });
      state.dirty = failed > 0;
      if (failed === 0 && !state.error) state.open = false;
    } catch (error) {
      state.error = errorMessage(error);
      options.notify({
        type: "error",
        message: `保存元数据失败：${state.error}`,
        key: "metadata-save",
      });
    } finally {
      acceptingProgress = false;
      state.saving = false;
    }
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
    prepareSave: () => prepareTargetSave(state.tracks.map(({ track }) => track.id)),
    retryFailed: () =>
      prepareTargetSave(
        state.results.flatMap((result) => (result.databaseUpdated ? [] : [result.trackId])),
      ),
  };
}

function saveMessage(targetCount: number, succeeded: number, failed: number, error: string) {
  let message = failed > 0 ? "元数据保存失败。" : "元数据已保存。";
  if (targetCount > 1) message = `元数据保存：${succeeded} 首成功，${failed} 首失败。`;
  return error ? `${message}\n${error}` : message;
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
    save: (trackIds, changes, progress, lyricsAction) => {
      const writeIds =
        changes.length > 0
          ? trackIds
          : trackIds.filter(
              (id) =>
                lyricsAction === "mark" &&
                sharedEditor?.state.tracks.some(
                  ({ track, lyrics }) => track.id === id && lyrics !== null,
                ),
            );
      const save = () => {
        const onProgress = new Channel<TagSaveResult>();
        onProgress.onmessage = progress;
        return api.saveMetadata(trackIds, changes, onProgress, lyricsAction);
      };
      return writeIds.length ? session.withMetadataEditing(writeIds, save) : save();
    },
    synchronize: synchronize.tracks,
    notify,
  });
  return sharedEditor;
}

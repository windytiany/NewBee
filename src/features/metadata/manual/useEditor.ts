import { t } from "@/shared/i18n/locale";
import { Channel, invoke } from "@tauri-apps/api/core";
import { reactive, toRefs } from "vue";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import type { LibraryAlbumSelection } from "@/features/library/types";
import { createLibraryApi } from "@/features/library/api";
import { createMetadataApi } from "@/features/metadata/api";
import { createTagSynchronization } from "@/features/metadata/synchronize";
import { createMetadataSave } from "@/features/metadata/save";
import type { MetadataFileEditor } from "@/features/metadata/save";
import { usePlaybackSession } from "@/features/playback/session";
import { buildTagChanges, createTagDraft } from "@/features/metadata/draft";
import type {
  CoverEdit,
  DraftField,
  EditableTrack,
  EditMode,
  LyricsMarkAction,
  TagChange,
  MetadataSaveResult,
} from "@/features/metadata/types";

export type TagEditorOptions = {
  loadTracks: (trackIds: number[]) => Promise<EditableTrack[]>;
  loadAlbum: (album: LibraryAlbumSelection) => Promise<number[]>;
  save: (
    trackIds: number[],
    changes: TagChange[],
    progress: (result: MetadataSaveResult) => void,
    lyricsAction: LyricsMarkAction,
    operationId?: string,
    cover?: CoverEdit | null,
  ) => Promise<MetadataSaveResult[]>;
  editFiles: MetadataFileEditor;
  synchronize: (trackIds: number[]) => Promise<void>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createTagEditor(options: TagEditorOptions) {
  const saving = createMetadataSave({ ...options, notifyResult: true });
  const state = reactive({
    ...toRefs(saving.state),
    open: false,
    mode: "tracks" as EditMode,
    loading: false,
    tracks: [] as EditableTrack[],
    draft: [] as DraftField[],
    dirty: false,
    lyricsAction: "keep" as LyricsMarkAction,
    cover: null as CoverEdit | null,
    confirmDiscard: false,
  });
  function reportError(event: string, error: unknown) {
    state.error = errorMessage(error);
    logger.error("metadata", event, error);
    notify({
      type: "error",
      message: event === "editor_load_failed" ? t("读取标签失败，请查看日志") : state.error,
      key: "tags-editor",
    });
  }
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
      cover: null,
      confirmDiscard: false,
      results: [],
      completed: 0,
      total: 0,
    });
    try {
      const ids = [...new Set(await loadIds())];
      if (ids.length === 0) throw new Error(t("没有可编辑的曲目。"));
      const tracks = await options.loadTracks(ids);
      if (!state.open || generation !== loadGeneration) return;
      if (
        tracks.length !== ids.length ||
        new Set(tracks.map(({ track }) => track.id)).size !== ids.length ||
        tracks.some(({ track }) => !ids.includes(track.id))
      ) {
        throw new Error(t("返回的曲目与编辑目标不匹配。"));
      }
      state.tracks = tracks;
      state.draft = createTagDraft(tracks, mode);
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
      if (state.open && generation === loadGeneration) reportError("editor_load_failed", error);
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
        changedOnly: true,
        allowEmpty: pendingLyricsAction !== "keep" || state.cover !== null,
      });
      if (pendingLyricsAction === "mark")
        pendingChanges = pendingChanges.filter(({ field }) => field !== "lyrics");
      pendingTrackIds = trackIds;
      if (pendingTrackIds.length === 0) return;
      void save();
    } catch (error) {
      reportError("editor_validation_failed", error);
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
      if (changes.length || action === "mark" || state.cover !== null) return [track.id];
      return [];
    });
    await saving.run({
      targets,
      writeTrackIds: writeIds,
      execute: (progress, operationId) =>
        options.save(ids, changes, progress, action, operationId, state.cover),
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
    coverSelectionFailed: (error: unknown) => reportError("editor_cover_failed", error),
    changeCover: (cover: CoverEdit) => {
      if (state.loading || state.saving) return;
      state.cover = cover;
      edited();
    },
    edited,
    save,
    prepareSave: () => prepareTargetSave(state.tracks.map(({ track }) => track.id)),
  };
}

let sharedEditor: ReturnType<typeof createTagEditor> | null = null;
export function useTagEditor() {
  if (sharedEditor) return sharedEditor;
  const session = usePlaybackSession();
  const api = createMetadataApi(invoke);
  const library = createLibraryApi(invoke);
  const synchronize = createTagSynchronization(session, invoke);
  sharedEditor = createTagEditor({
    loadTracks: api.editableTracks,
    loadAlbum: async (album) => (await library.listAlbumTracks(album)).map((track) => track.id),
    save: (trackIds, changes, progress, lyricsAction, operationId, cover) => {
      const onProgress = new Channel<MetadataSaveResult>();
      onProgress.onmessage = progress;
      return api.saveMetadata(trackIds, changes, onProgress, lyricsAction, operationId, cover);
    },
    editFiles: session.withMetadataEditing,
    synchronize: synchronize.tracks,
  });
  return sharedEditor;
}

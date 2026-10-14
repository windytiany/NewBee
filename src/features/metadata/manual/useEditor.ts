import { t } from "@/shared/i18n/locale";
import { Channel, invoke } from "@tauri-apps/api/core";
import { computed, reactive, toRefs } from "vue";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import type { LibraryAlbumSelection } from "@/features/library/types";
import { createLibraryApi } from "@/features/library/api";
import { createMetadataApi } from "@/features/metadata/api";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { createManualSave } from "@/features/metadata/manual/save";
import type { ManualSaveOptions, ManualSaveRequest } from "@/features/metadata/manual/save";
import { usePlaybackSession } from "@/features/playback/session";
import { buildTagChanges, createTagDraft } from "@/features/metadata/draft";
import type {
  DraftField,
  EditableTrack,
  EditMode,
  LyricsMarkAction,
  MetadataSaveResult,
} from "@/features/metadata/types";

import { createArtworkCollectionApi } from "@/features/artwork/collection/api";
import {
  addPicture,
  changePictureType,
  commonPictures,
  createCollectionDraft,
  deletePicture,
  displaySelection,
  serializeCollections,
  setDisplayPicture,
} from "@/features/artwork/collection/model";
import type { CollectionDraft } from "@/features/artwork/collection/types";

export type TagEditorOptions = ManualSaveOptions & {
  loadTracks: (trackIds: number[]) => Promise<EditableTrack[]>;
  readArtwork: (artworkId: number) => Promise<ArrayBuffer>;
  loadAlbum: (album: LibraryAlbumSelection) => Promise<number[]>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createTagEditor(options: TagEditorOptions) {
  const saving = createManualSave(options);
  const state = reactive({
    ...toRefs(saving.state),
    open: false,
    mode: "tracks" as EditMode,
    loading: false,
    tracks: [] as EditableTrack[],
    draft: [] as DraftField[],
    dirty: false,
    lyricsAction: "keep" as LyricsMarkAction,
    artwork: { tracks: [] } as CollectionDraft,
    importingArtwork: false,
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
  let preparedSave: ManualSaveRequest | null = null;

  async function open(loadIds: () => Promise<number[]>, mode: EditMode) {
    if (state.open) return;
    const generation = ++loadGeneration;
    saving.reset();
    preparedSave = null;
    Object.assign(state, {
      open: true,
      mode,
      loading: true,
      tracks: [],
      draft: [],
      error: "",
      dirty: false,
      lyricsAction: "keep",
      artwork: { tracks: [] },
      importingArtwork: false,
      confirmDiscard: false,
      results: [],
      completed: 0,
      total: 0,
    });
    try {
      const ids = [...new Set(await loadIds())];
      if (!state.open || generation !== loadGeneration) return;
      if (ids.length === 0) throw new Error(t("没有可编辑的曲目。"));
      const tracks = await options.loadTracks(ids);
      if (!state.open || generation !== loadGeneration) return;
      if (
        tracks.length !== ids.length ||
        new Set(tracks.map(({ track }) => track.id)).size !== ids.length ||
        tracks.some(
          ({ track }) =>
            typeof track.id !== "number" ||
            !Number.isSafeInteger(track.id) ||
            track.id <= 0 ||
            !ids.includes(track.id),
        ) ||
        new Set(tracks.map(({ track }) => track.path)).size !== ids.length
      ) {
        throw new Error(t("返回的曲目与编辑目标不匹配。"));
      }
      state.tracks = tracks;
      saving.setTargets(
        tracks.flatMap(({ track }) =>
          typeof track.id === "number" ? [{ trackId: track.id, path: track.path }] : [],
        ),
      );
      state.draft = createTagDraft(tracks, mode);
      const trackIds = numericIds();
      try {
        const collections = await options.loadCollections(trackIds);
        if (!state.open || generation !== loadGeneration) return;
        state.artwork = createCollectionDraft(trackIds, collections);
      } catch (error) {
        if (!state.open || generation !== loadGeneration) return;
        state.artwork = createCollectionDraft(trackIds, []);
        for (const track of state.artwork.tracks) track.error = errorMessage(error);
        reportError("editor_artwork_failed", error);
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
      if (state.open && generation === loadGeneration) reportError("editor_load_failed", error);
    } finally {
      if (generation === loadGeneration) state.loading = false;
    }
  }

  function close() {
    if (state.saving || state.importingArtwork) return;
    ++loadGeneration;
    state.open = false;
    state.confirmDiscard = false;
  }

  function requestClose() {
    if (state.saving || state.importingArtwork) return;
    if (state.dirty) state.confirmDiscard = true;
    else close();
  }

  function changeField(field: DraftField, value: string) {
    if (state.loading || state.saving || state.importingArtwork || !field.writable) return;
    field.value = value;
    field.mixed = false;
    if (field.key === "lyrics" && value.trim() && state.lyricsAction === "mark") {
      state.lyricsAction = "keep";
    }
    edited();
  }

  function changeLyricsAction(action: LyricsMarkAction) {
    if (state.loading || state.saving || state.importingArtwork) return;
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

  function numericIds(): number[] {
    return state.tracks.map(({ track }) => {
      if (typeof track.id !== "number") throw new Error(t("返回的曲目与编辑目标不匹配。"));
      return track.id;
    });
  }

  const artworkReady = computed(
    () =>
      state.artwork.tracks.length > 0 && state.artwork.tracks.every(({ error }) => error === null),
  );
  function changeArtwork(change: () => void) {
    if (state.loading || state.saving || state.importingArtwork || !artworkReady.value) return;
    try {
      change();
      edited();
    } catch (error) {
      reportError("editor_artwork_failed", error);
    }
  }
  async function importPicture(data: Uint8Array, mimeType: string, pictureType = 3, path?: string) {
    if (state.loading || state.saving || state.importingArtwork || !artworkReady.value) return;
    state.importingArtwork = true;
    try {
      const key = await addPicture(
        state.artwork,
        data,
        mimeType,
        options.readArtwork,
        pictureType,
        path,
      );
      edited();
      return key;
    } catch (error) {
      reportError("editor_artwork_failed", error);
    } finally {
      state.importingArtwork = false;
    }
  }

  async function retrySynchronization() {
    if (state.loading || state.saving || state.importingArtwork) return;
    const result = await saving.retrySynchronization(state.artwork);
    if (!state.dirty && !result.hasError) close();
  }

  function prepareTargetSave(trackIds: number[]) {
    if (state.loading || state.saving || state.importingArtwork) return;
    state.error = "";
    try {
      const pendingTrackIds = saving.remainingIds(trackIds);
      if (!pendingTrackIds.length) {
        void retrySynchronization();
        return;
      }
      const artwork = serializeCollections(state.artwork).filter(({ trackId }) =>
        pendingTrackIds.includes(trackId),
      );
      const lyricsAction = state.lyricsAction;
      let changes = buildTagChanges(state.draft, state.tracks, {
        changedOnly: true,
        allowEmpty: true,
      });
      if (!changes.length && lyricsAction === "keep" && !artwork.length) {
        state.dirty = false;
        void retrySynchronization();
        return;
      }
      if (lyricsAction === "mark") changes = changes.filter(({ field }) => field !== "lyrics");
      preparedSave = { trackIds: pendingTrackIds, changes, lyricsAction, artwork: state.artwork };
      void save();
    } catch (error) {
      reportError("editor_validation_failed", error);
    }
  }

  async function save() {
    if (state.loading || state.saving || state.importingArtwork || !preparedSave) return;
    const result = await saving.run(preparedSave);
    state.dirty = result.failed;
    if (!state.dirty && !result.hasError) state.open = false;
  }

  return {
    state,
    openTracks: (ids: readonly number[]) => open(() => Promise.resolve([...ids]), "tracks"),
    openAlbum: (album: LibraryAlbumSelection) => open(() => options.loadAlbum(album), "album"),
    requestClose,
    close,
    changeField,
    changeLyricsAction,
    artworkReady,
    pictures: computed(() => commonPictures(state.artwork)),
    displayPicture: computed(() => displaySelection(state.artwork)),
    addPicture: importPicture,
    changePictureType: (key: string, pictureType: number) =>
      changeArtwork(() => changePictureType(state.artwork, key, pictureType)),
    deletePicture: (key: string) => changeArtwork(() => deletePicture(state.artwork, key)),
    setDisplayPicture: (key: string) => changeArtwork(() => setDisplayPicture(state.artwork, key)),
    artworkSelectionFailed: (error: unknown) => reportError("editor_artwork_failed", error),
    retrySynchronization,
    edited,
    save,
    prepareSave: () => prepareTargetSave(numericIds()),
  };
}

let sharedEditor: ReturnType<typeof createTagEditor> | null = null;
export function useTagEditor() {
  if (sharedEditor) return sharedEditor;
  const session = usePlaybackSession();
  const api = createMetadataApi(invoke);
  const library = createLibraryApi(invoke);
  const artwork = createArtworkCollectionApi(invoke);
  const synchronize = createTrackSynchronization(session, invoke);
  sharedEditor = createTagEditor({
    loadTracks: api.editableTracks,
    loadCollections: artwork.collections,
    readArtwork: artwork.picture,
    planArtwork: artwork.writePlan,
    loadAlbum: async (album) => (await library.listAlbumTracks(album)).map((track) => track.id),
    save: (trackIds, changes, progress, lyricsAction, operationId, artworkDrafts) => {
      const onProgress = new Channel<MetadataSaveResult>();
      onProgress.onmessage = progress;
      return api.saveMetadata(
        trackIds,
        changes,
        onProgress,
        lyricsAction,
        operationId,
        artworkDrafts,
      );
    },
    editFiles: session.withMetadataEditing,
    synchronize: synchronize.refresh,
  });
  return sharedEditor;
}

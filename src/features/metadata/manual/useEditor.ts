import type { MetadataTarget } from "@/features/metadata/types";
import { t } from "@/shared/i18n/locale";
import { Channel, invoke } from "@tauri-apps/api/core";
import { computed, reactive, toRefs } from "vue";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import type { LibraryAlbumSelection } from "@/features/library/types";
import { createLibraryApi } from "@/features/library/api";
import { createMetadataApi } from "@/features/metadata/api";
import { createTagSynchronization } from "@/features/metadata/synchronize";
import { createMetadataSave, metadataSaved } from "@/features/metadata/save";
import type { MetadataFileEditor } from "@/features/metadata/save";
import { usePlaybackSession } from "@/features/playback/session";
import { buildTagChanges, createTagDraft } from "@/features/metadata/draft";
import type {
  DraftField,
  EditableTrack,
  EditMode,
  LyricsMarkAction,
  TagChange,
  MetadataSaveResult,
} from "@/features/metadata/types";

import { planCollectionWrites } from "@/features/artwork/collection/plan";
import { createArtworkCollectionApi } from "@/features/artwork/collection/api";
import { createTracksApi } from "@/features/tracks/api";
import { createManualLoading } from "@/features/metadata/manual/loading";
import {
  acceptCollectionChanges,
  addPicture,
  changePictureType,
  commonPictures,
  createCollectionDraft,
  deletePicture,
  displaySelection,
  serializeCollections,
  setDisplayPicture,
} from "@/features/artwork/collection/model";
import type {
  ArtworkCollection,
  ArtworkDraft,
  ArtworkWritePlan,
  CollectionDraft,
} from "@/features/artwork/collection/types";

export type TagEditorOptions = {
  loadTracks: (trackIds: MetadataTarget[]) => Promise<EditableTrack[]>;
  loadCollections: (trackIds: number[]) => Promise<ArtworkCollection[]>;
  readArtwork: (artworkId: number) => Promise<ArrayBuffer>;
  planArtwork: (artworkDrafts: ArtworkDraft[]) => Promise<ArtworkWritePlan[]>;
  loadAlbum: (album: LibraryAlbumSelection) => Promise<MetadataTarget[]>;
  save: (
    trackIds: number[],
    changes: TagChange[],
    progress: (result: MetadataSaveResult) => void,
    lyricsAction: LyricsMarkAction,
    operationId: string | undefined,
    artworkDrafts: ArtworkDraft[],
  ) => Promise<MetadataSaveResult[]>;
  editFiles: MetadataFileEditor;
  synchronize: (trackIds: MetadataTarget[]) => Promise<void>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createTagEditor(options: TagEditorOptions) {
  const fileTargets = new Map<number, string>();
  const saving = createMetadataSave({
    ...options,
    notifyResult: true,
    synchronize: (ids) =>
      options.synchronize([
        ...ids,
        ...ids.flatMap((id) => {
          const path = typeof id === "number" ? fileTargets.get(id) : undefined;
          return path === undefined ? [] : [path];
        }),
      ]),
  });
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
  let pendingChanges: TagChange[] = [];
  let pendingTrackIds: number[] = [];
  let pendingArtwork: ArtworkDraft[] = [];
  let pendingLyricsAction: LyricsMarkAction = "keep";
  const pendingArtworkReload = new Set<number>();

  async function open(loadIds: () => Promise<MetadataTarget[]>, mode: EditMode) {
    if (state.open) return;
    const generation = ++loadGeneration;
    saving.reset();
    fileTargets.clear();
    pendingArtworkReload.clear();
    pendingTrackIds = [];
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
            (ids.every((id) => typeof id === "number")
              ? !ids.includes(track.id)
              : !ids.every((id) => typeof id === "string") || !ids.includes(track.path)),
        ) ||
        new Set(tracks.map(({ track }) => track.path)).size !== ids.length
      ) {
        throw new Error(t("返回的曲目与编辑目标不匹配。"));
      }
      state.tracks = tracks;
      if (ids.every((id) => typeof id === "string"))
        for (const { track } of tracks)
          if (typeof track.id === "number") fileTargets.set(track.id, track.path);
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

  async function reloadSavedArtwork() {
    const ids = [...pendingArtworkReload];
    if (!ids.length) return;
    state.saving = true;
    try {
      const reloaded = createCollectionDraft(ids, await options.loadCollections(ids));
      for (const track of reloaded.tracks) {
        const index = state.artwork.tracks.findIndex((entry) => entry.trackId === track.trackId);
        state.artwork.tracks[index] = track;
        if (track.error === null) pendingArtworkReload.delete(track.trackId);
      }
      const errors = reloaded.tracks.flatMap(({ error }) => (error === null ? [] : [error]));
      if (errors.length) throw new Error(errors.join("\n"));
    } catch (error) {
      for (const track of state.artwork.tracks)
        if (pendingArtworkReload.has(track.trackId)) track.error = errorMessage(error);
      state.error = errorMessage(error);
      logger.error("metadata", "editor_artwork_refresh_failed", error);
    } finally {
      state.saving = false;
    }
  }

  async function retrySynchronization() {
    if (state.loading || state.saving || state.importingArtwork) return;
    state.error = "";
    await reloadSavedArtwork();
    await saving.retrySynchronization();
    if (!state.dirty && !state.synchronizationError && !state.error) close();
  }

  function prepareTargetSave(trackIds: number[]) {
    if (state.loading || state.saving || state.importingArtwork) return;
    state.error = "";
    try {
      pendingTrackIds = trackIds.filter(
        (id) => !state.results.some((result) => result.trackId === id && metadataSaved(result)),
      );
      if (!pendingTrackIds.length) {
        void retrySynchronization();
        return;
      }
      pendingArtwork = serializeCollections(state.artwork).filter(({ trackId }) =>
        pendingTrackIds.includes(trackId),
      );
      pendingLyricsAction = state.lyricsAction;
      pendingChanges = buildTagChanges(state.draft, state.tracks, {
        changedOnly: true,
        allowEmpty: state.dirty || pendingLyricsAction !== "keep" || pendingArtwork.length > 0,
      });
      if (!pendingChanges.length && pendingLyricsAction === "keep" && !pendingArtwork.length) {
        state.dirty = false;
        void retrySynchronization();
        return;
      }
      if (pendingLyricsAction === "mark")
        pendingChanges = pendingChanges.filter(({ field }) => field !== "lyrics");
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
      typeof track.id === "number" && ids.includes(track.id)
        ? [{ trackId: track.id, path: track.path }]
        : [],
    );
    let saveIds = ids;
    await saving.run({
      targets,
      writeTrackIds: ids.filter(() => changes.length || action === "mark"),
      prepareWriteTrackIds: pendingArtwork.length
        ? async (progress) => {
            const plan = await planCollectionWrites(pendingArtwork, options.planArtwork);
            const failed = new Set<number>();
            const artworkWrites = new Set<number>();
            for (const entry of plan) {
              if (entry.error !== null) {
                failed.add(entry.trackId);
                progress({
                  trackId: entry.trackId,
                  path: targets.find(({ trackId }) => trackId === entry.trackId)?.path ?? "",
                  fileWritten: false,
                  databaseUpdated: false,
                  error: entry.error,
                });
              } else if (entry.fileWriteRequired) artworkWrites.add(entry.trackId);
            }
            saveIds = ids.filter((id) => !failed.has(id));
            return saveIds.filter(
              (id) => changes.length || action === "mark" || artworkWrites.has(id),
            );
          }
        : undefined,
      execute: (progress, operationId) =>
        saveIds.length
          ? options.save(
              saveIds,
              changes,
              progress,
              action,
              operationId,
              pendingArtwork.filter(({ trackId }) => saveIds.includes(trackId)),
            )
          : Promise.resolve([]),
    });
    const successfulIds = state.results.flatMap((result) =>
      typeof result.trackId === "number" && ids.includes(result.trackId) && metadataSaved(result)
        ? [result.trackId]
        : [],
    );
    acceptCollectionChanges(state.artwork, successfulIds);
    for (const { trackId } of pendingArtwork)
      if (successfulIds.includes(trackId)) pendingArtworkReload.add(trackId);
    await reloadSavedArtwork();
    const failed = state.results.filter((result) => !metadataSaved(result)).length;
    const error = [state.error, state.synchronizationError].filter(Boolean).join("\n");
    state.dirty = failed > 0;
    if (!state.dirty && !error) state.open = false;
  }

  return {
    state,
    openTracks: (ids: readonly MetadataTarget[]) => open(() => Promise.resolve([...ids]), "tracks"),
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
  const synchronize = createTagSynchronization(session, invoke);
  sharedEditor = createTagEditor({
    loadTracks: createManualLoading(api, createTracksApi(invoke)),
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
    synchronize: synchronize.tracks,
  });
  return sharedEditor;
}

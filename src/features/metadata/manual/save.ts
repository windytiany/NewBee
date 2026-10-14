import { computed, reactive, toRefs } from "vue";
import { logger } from "@/shared/logging/logger";
import { createMetadataSave, metadataSaved } from "@/features/metadata/save";
import type { MetadataFileEditor } from "@/features/metadata/save";
import type { LyricsMarkAction, MetadataSaveResult, TagChange } from "@/features/metadata/types";
import { planCollectionWrites } from "@/features/artwork/collection/plan";
import {
  acceptCollectionChanges,
  createCollectionDraft,
  serializeCollections,
} from "@/features/artwork/collection/model";
import type {
  ArtworkCollection,
  ArtworkDraft,
  ArtworkWritePlan,
  CollectionDraft,
} from "@/features/artwork/collection/types";

export type ManualSaveOptions = {
  loadCollections: (trackIds: number[]) => Promise<ArtworkCollection[]>;
  planArtwork: (drafts: ArtworkDraft[]) => Promise<ArtworkWritePlan[]>;
  save: (
    trackIds: number[],
    changes: TagChange[],
    progress: (result: MetadataSaveResult) => void,
    lyricsAction: LyricsMarkAction,
    operationId: string | undefined,
    artworkDrafts: ArtworkDraft[],
  ) => Promise<MetadataSaveResult[]>;
  editFiles: MetadataFileEditor;
  synchronize: (trackIds: number[]) => Promise<void>;
};
export type ManualSaveRequest = {
  trackIds: number[];
  changes: TagChange[];
  lyricsAction: LyricsMarkAction;
  artwork: CollectionDraft;
};

export function createManualSave(options: ManualSaveOptions) {
  const targets = new Map<number, string>();
  const pendingArtworkReload = new Set<number>();
  const lifecycle = reactive({ busy: false });
  const saving = createMetadataSave({
    ...options,
    notifyResult: true,
  });
  const state = reactive({
    ...toRefs(saving.state),
    saving: computed(() => lifecycle.busy || saving.state.saving),
  });

  function reset() {
    if (state.saving) return;
    saving.reset();
    targets.clear();
    pendingArtworkReload.clear();
  }
  function setTargets(entries: { trackId: number; path: string }[]) {
    if (state.saving) return;
    targets.clear();
    for (const entry of entries) targets.set(entry.trackId, entry.path);
  }
  function remainingIds(ids: number[]) {
    return ids.filter(
      (id) => !state.results.some((result) => result.trackId === id && metadataSaved(result)),
    );
  }
  function outcome() {
    return {
      failed: state.results.some((result) => !metadataSaved(result)),
      hasError: Boolean(state.error || state.synchronizationError),
    };
  }
  async function reloadArtwork(artwork: CollectionDraft) {
    const ids = [...pendingArtworkReload];
    if (!ids.length) return;
    try {
      const reloaded = createCollectionDraft(ids, await options.loadCollections(ids));
      for (const track of reloaded.tracks) {
        const index = artwork.tracks.findIndex((entry) => entry.trackId === track.trackId);
        artwork.tracks[index] = track;
        if (track.error === null) pendingArtworkReload.delete(track.trackId);
      }
      const errors = reloaded.tracks.flatMap(({ error }) => (error === null ? [] : [error]));
      if (errors.length) throw new Error(errors.join("\n"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const track of artwork.tracks)
        if (pendingArtworkReload.has(track.trackId)) track.error = message;
      state.error = message;
      logger.error("metadata", "editor_artwork_refresh_failed", error);
    }
  }
  async function retrySynchronization(artwork: CollectionDraft) {
    if (state.saving) return outcome();
    lifecycle.busy = true;
    state.error = "";
    try {
      await reloadArtwork(artwork);
      await saving.retrySynchronization();
      return outcome();
    } finally {
      lifecycle.busy = false;
    }
  }
  async function run(request: ManualSaveRequest) {
    if (state.saving) return outcome();
    const ids = remainingIds(request.trackIds);
    if (!ids.length) return retrySynchronization(request.artwork);
    const changes = request.changes.map((change) => ({ ...change }));
    const action = request.lyricsAction;
    const artworkDrafts = serializeCollections(request.artwork).filter(({ trackId }) =>
      ids.includes(trackId),
    );
    let saveIds = ids;
    lifecycle.busy = true;
    try {
      await saving.run({
        targets: ids.map((trackId) => ({ trackId, path: targets.get(trackId) ?? "" })),
        writeTrackIds: ids.filter(() => changes.length || action === "mark"),
        prepareWriteTrackIds: artworkDrafts.length
          ? async (progress) => {
              const plan = await planCollectionWrites(artworkDrafts, options.planArtwork);
              const failed = new Set<number>();
              const artworkWrites = new Set<number>();
              for (const entry of plan) {
                if (entry.error !== null) {
                  failed.add(entry.trackId);
                  progress({
                    trackId: entry.trackId,
                    path: targets.get(entry.trackId) ?? "",
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
                artworkDrafts.filter(({ trackId }) => saveIds.includes(trackId)),
              )
            : Promise.resolve([]),
      });
      const successfulIds = state.results.flatMap((result) =>
        typeof result.trackId === "number" && ids.includes(result.trackId) && metadataSaved(result)
          ? [result.trackId]
          : [],
      );
      acceptCollectionChanges(request.artwork, successfulIds);
      for (const { trackId } of artworkDrafts)
        if (successfulIds.includes(trackId)) pendingArtworkReload.add(trackId);
      await reloadArtwork(request.artwork);
      return outcome();
    } finally {
      lifecycle.busy = false;
    }
  }
  return { state, reset, setTargets, remainingIds, run, retrySynchronization };
}

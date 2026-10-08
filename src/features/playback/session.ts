import { invoke } from "@tauri-apps/api/core";
import { createTrackSkipState } from "@/features/playback/queue/skip";
import { logger } from "@/shared/logging/logger";
import { computed, readonly, ref, watch } from "vue";
import { PlaybackQueueCoordinator } from "@/features/playback/queue/coordinator";
import type {
  PlaybackQueueSnapshot,
  QueuePlaybackAttempt,
} from "@/features/playback/queue/coordinator";
import {
  createPlaybackQueueSnapshotWriter,
  EMPTY_PLAYBACK_QUEUE_SNAPSHOT,
  loadPlaybackQueueSnapshot,
} from "@/features/playback/queue/persistence";
import type { PlaybackQueuePersistenceSnapshot } from "@/features/playback/queue/persistence";
import { createPlaybackSessionCommands } from "@/features/playback/runtime/commands";
import { createPlaybackStatusObserver } from "@/features/playback/runtime/status";
import { createPlaybackState } from "@/features/playback/runtime/state";
import type {
  PlaybackCommandInvoker,
  PlaybackStartFailure,
  PlaybackTransition,
  PlaybackDisplayTrack,
  TrackMetadataUpdate,
} from "@/features/playback/types";

import type { TrackLyrics } from "@/features/lyrics/types";

export type { PlaybackStatus } from "@/features/playback/types";

export const PLAYBACK_STATUS_POLL_INTERVAL_MS = 500;

export type PlaybackSessionOptions = {
  invokeCommand?: PlaybackCommandInvoker;
  restoredQueueSnapshot?: PlaybackQueuePersistenceSnapshot | null;
};

export function createPlaybackSession(options: PlaybackSessionOptions = {}) {
  const invokeCommand = options.invokeCommand ?? invoke;
  const restoredQueueSnapshot =
    options.restoredQueueSnapshot === undefined
      ? loadPlaybackQueueSnapshot()
      : options.restoredQueueSnapshot;
  const initialQueueSnapshot = restoredQueueSnapshot ?? EMPTY_PLAYBACK_QUEUE_SNAPSHOT;
  const restoredStartRowKey = restoredQueueSnapshot?.currentRowKey ?? null;
  const writeQueueSnapshot = createPlaybackQueueSnapshotWriter(restoredQueueSnapshot);
  const trackSkip = createTrackSkipState(invokeCommand);
  const playbackState = createPlaybackState(invokeCommand);
  const currentTrack = playbackState.currentTrack;
  const sidecarLyrics = ref<TrackLyrics | null>(null);
  let sidecarRequest = 0;
  watch(
    () => [currentTrack.value?.trackId ?? null, currentTrack.value?.playbackId ?? null] as const,
    ([trackId, playbackId], previous) => {
      if (trackId === previous?.[0] && playbackId === previous?.[1]) return;
      // File editing detaches the audio instance, but keeps the listening session.
      if (trackId !== null && trackId === previous?.[0] && playbackId === null) return;
      const request = ++sidecarRequest;
      sidecarLyrics.value = null;
      if (trackId === null || playbackId === null) return;
      void invokeCommand<TrackLyrics | null>("get_playback_sidecar_lyrics", { trackId })
        .then((lyrics) => {
          if (request === sidecarRequest) sidecarLyrics.value = lyrics ?? null;
        })
        .catch((error: unknown) => {
          logger.warn("lyrics", "sidecar_read_failed", error, { trackId });
        });
    },
    { flush: "sync", immediate: true },
  );
  const playbackError = ref("");
  const isSeeking = ref(false);
  const isSessionCommandPending = ref(false);
  const displayedTracks = ref<PlaybackDisplayTrack[]>([]);
  const currentRowKey = ref<string | null>(null);
  const queuePlaybackError = ref("");
  const repeatOneEnabled = ref(false);
  const shuffleEnabled = ref(false);
  const canPlayPrevious = ref(false);
  const canPlayNext = ref(false);
  const isPlaybackCommandPending = computed(
    () => isSessionCommandPending.value || playbackState.isCommandPending.value,
  );
  const canStartRestoredQueue = computed(
    () =>
      restoredStartRowKey !== null &&
      currentRowKey.value === restoredStartRowKey &&
      displayedTracks.value.some((track) => track.rowKey === restoredStartRowKey),
  );
  const activeQueueRowKey = computed(() => {
    const track = currentTrack.value;
    const rowKey = currentRowKey.value;
    if (track === null || track.playbackId === null || rowKey === null) return null;

    return displayedTracks.value.some(
      (item) => item.rowKey === rowKey && item.trackId === track.trackId,
    )
      ? rowKey
      : null;
  });
  const readonlyDisplayedTracks = readonly(displayedTracks);
  const readonlyCurrentRowKey = readonly(currentRowKey);
  const readonlyQueuePlaybackError = readonly(queuePlaybackError);
  const readonlyRepeatOneEnabled = readonly(repeatOneEnabled);
  const readonlyShuffleEnabled = readonly(shuffleEnabled);
  const readonlyCanPlayPrevious = readonly(canPlayPrevious);
  const readonlyCanPlayNext = readonly(canPlayNext);

  function syncQueueState(snapshot: PlaybackQueueSnapshot) {
    displayedTracks.value = [...snapshot.displayedTracks];
    currentRowKey.value = snapshot.currentRowKey;
    if (snapshot.queuePlaybackError && snapshot.queuePlaybackError !== queuePlaybackError.value) {
      logger.error("playback.queue", "transition_failed", snapshot.queuePlaybackError);
    }
    queuePlaybackError.value = snapshot.queuePlaybackError;
    repeatOneEnabled.value = snapshot.repeatOneEnabled;
    shuffleEnabled.value = snapshot.shuffleEnabled;
    canPlayPrevious.value = snapshot.canPlayPrevious;
    canPlayNext.value = snapshot.canPlayNext;
  }

  function waitForPlaybackCommand() {
    if (!isPlaybackCommandPending.value) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const stopWatching = watch(
        isPlaybackCommandPending,
        (isPending) => {
          if (isPending) return;
          stopWatching();
          resolve();
        },
        { flush: "sync" },
      );
    });
  }

  async function attemptPlayback(
    trackId: number,
    canStart: () => boolean,
    rowKey: string,
  ): Promise<QueuePlaybackAttempt> {
    while (isPlaybackCommandPending.value) {
      if (!canStart()) return { status: "cancelled" };
      await waitForPlaybackCommand();
    }
    if (!canStart()) return { status: "cancelled" };

    if (!(await playbackState.startTrack(trackId, canStart, rowKey))) {
      if (!canStart()) return { status: "cancelled" };
      const failure: PlaybackStartFailure = playbackState.consumePlaybackStartFailure() ?? {
        kind: "playback-failed",
        message: playbackState.playbackStartError.value || "播放命令未执行",
      };
      return { status: "failed", failure };
    }

    const playbackId = currentTrack.value?.playbackId;
    if (playbackId === null || playbackId === undefined) {
      return {
        status: "failed",
        failure: { kind: "playback-failed", message: "未能确认播放实例" },
      };
    }

    return { status: "started", playbackId };
  }

  let preparationRevision = 0;
  let preparationGeneration = 0;
  let preparationSignature = "";
  let preparedSuccessor: { playbackId: number; rowKey: string } | null = null;

  async function synchronizeNextTrack() {
    const plan = coordinator.gaplessPlan;
    const signature = JSON.stringify(
      plan === null ? null : [plan.playbackId, plan.candidates.map((item) => item.rowKey)],
    );
    if (signature === preparationSignature) return;
    preparationSignature = signature;
    if (
      plan !== null &&
      preparedSuccessor?.playbackId === plan.playbackId &&
      preparedSuccessor.rowKey === plan.candidates[0]?.rowKey
    )
      return;
    preparedSuccessor = null;
    const generation = ++preparationGeneration;
    if (plan === null) return;
    const candidates = plan.candidates.length > 0 ? plan.candidates : [null];
    for (const item of candidates) {
      if (generation !== preparationGeneration) return;
      try {
        const accepted = await invokeCommand<boolean>("prepare_next_track", {
          playbackId: plan.playbackId,
          revision: ++preparationRevision,
          trackId: item?.trackId ?? null,
          rowKey: item?.rowKey ?? null,
        });
        if (generation !== preparationGeneration) return;
        if (accepted) {
          if (item !== null) {
            preparedSuccessor = { playbackId: plan.playbackId, rowKey: item.rowKey };
          }
          return;
        }
        // The backend may already have crossed the boundary. Reconcile via status.
        await statusObserver.refreshAfterCommand();
        return;
      } catch (error) {
        if (generation !== preparationGeneration) return;
        logger.warn("playback", "next_track_preparation_failed", error, { trackId: item?.trackId });
        const message = error instanceof Error ? error.message : String(error);
        if (item === null) {
          playbackError.value = `Could not cancel next track: ${message}`;
          return;
        }
        const missingPrefix = "AUDIO_FILE_NOT_FOUND:";
        coordinator.reportPreparationFailure(item, {
          kind: message.startsWith(missingPrefix) ? "audio-file-not-found" : "playback-failed",
          message: message.startsWith(missingPrefix)
            ? message.slice(missingPrefix.length)
            : message,
        });
      }
    }
  }

  function observePlaybackTransition(track: PlaybackTransition): boolean {
    if (currentTrack.value?.playbackId === track.playbackId) return false;
    if (currentTrack.value?.playbackId !== track.previousPlaybackId) return false;
    if (
      !coordinator.confirmGaplessTransition(
        track.previousPlaybackId,
        track.playbackId,
        track.rowKey,
        track.trackId,
      )
    )
      return false;
    return playbackState.adoptTransition(track);
  }

  async function loadTrackPreferences(): Promise<boolean> {
    try {
      await trackSkip.load();
      return true;
    } catch (error) {
      const message = `读取跳过标记失败：${error instanceof Error ? error.message : String(error)}`;
      logger.error("playback", "preferences_load_failed", error);
      playbackError.value = message;

      return false;
    }
  }

  const coordinator = new PlaybackQueueCoordinator(
    attemptPlayback,
    (snapshot, persistenceSnapshot) => {
      syncQueueState(snapshot);
      writeQueueSnapshot(persistenceSnapshot);
      void Promise.resolve().then(synchronizeNextTrack);
    },
    {
      isTrackSkipped: trackSkip.isSkipped,
      loadTrackPreferences,
      clearPlayback: () => {
        playbackState.resetCurrentTrack();
        playbackState.consumePlaybackStartFailure();
        playbackError.value = "";
      },
      stopPlayback: playbackState.stopPlayback,
      stopStalePlayback: playbackState.stopStalePlayback,
      finishPlayback: async (playbackId, canFinish) => {
        await playbackState.finishPlayback(playbackId, canFinish);
        if (canFinish()) await statusObserver.refreshAfterCommand();
      },
    },
  );
  coordinator.restoreQueue(initialQueueSnapshot);
  watch(trackSkip.skippedTrackIds, () => coordinator.refreshTrackPreferences(), { flush: "sync" });
  void loadTrackPreferences();

  const statusObserver = createPlaybackStatusObserver({
    invokeCommand,
    currentTrack,
    isCommandPending: isPlaybackCommandPending,
    isSeeking,
    activeQueueRowKey,
    playbackError,
    observePlaybackTransition,
    observePlaybackState: (playbackId, isPlaying, hasReachedEnd) =>
      coordinator.observePlaybackState(playbackId, isPlaying, hasReachedEnd),
  });
  const commands = createPlaybackSessionCommands({
    invokeCommand,
    playbackState,
    coordinator,
    currentTrack,
    currentStatus: statusObserver.internalStatus,
    displayedTracks: readonlyDisplayedTracks,
    currentRowKey: readonlyCurrentRowKey,
    canStartRestoredQueue,
    restoredStartRowKey,
    isTrackSkipped: trackSkip.isSkipped,
    loadTrackPreferences,
    playbackError,
    isCommandPending: isPlaybackCommandPending,
    isSessionCommandPending,
    isSeeking,
    refreshStatus: statusObserver.refreshAfterCommand,
    invalidateStatus: statusObserver.invalidate,
  });
  const publicCurrentTrack = readonly(
    computed(() => {
      const track = currentTrack.value;
      if (track === null) return null;
      return { trackId: track.trackId, title: track.title, artist: track.artist };
    }),
  );

  const state = Object.freeze({
    sidecarLyrics: readonly(sidecarLyrics),
    playbackStatus: statusObserver.status,
    isPlaybackStatusSettled: statusObserver.isSettled,
    playbackError: readonly(playbackError),
    currentTrack: publicCurrentTrack,
    currentPlaybackId: computed(() => currentTrack.value?.playbackId ?? null),
    isPlaybackCommandPending: readonly(isPlaybackCommandPending),
    isSeeking: readonly(isSeeking),
    canStartRestoredQueue: readonly(canStartRestoredQueue),
    displayedTracks: readonlyDisplayedTracks,
    currentRowKey: readonlyCurrentRowKey,
    activeQueueRowKey: readonly(activeQueueRowKey),
    queuePlaybackError: readonlyQueuePlaybackError,
    repeatOneEnabled: readonlyRepeatOneEnabled,
    shuffleEnabled: readonlyShuffleEnabled,
    canPlayPrevious: readonlyCanPlayPrevious,
    canPlayNext: readonlyCanPlayNext,
    playbackStartError: playbackState.playbackStartError,
    skippedTrackIds: trackSkip.skippedTrackIds,
    isTrackSkipPending: trackSkip.isPending,
  });

  return Object.freeze({
    state,
    refreshPlaybackStatus: statusObserver.refresh,
    setTracksSkipped: trackSkip.setTracksSkipped,
    loadTrackSkipPreferences: trackSkip.load,
    observePlaybackTransition,
    updateTrackMetadata: (tracks: readonly TrackMetadataUpdate[]) => {
      coordinator.updateTrackMetadata(tracks);
      for (const track of tracks) playbackState.updateTrackMetadata(track);
    },
    ...commands,
    removeQueueItems: coordinator.removeQueueItems.bind(coordinator),
    removeTrackFromQueue: coordinator.removeTrackFromQueue.bind(coordinator),
    clearQueue: coordinator.clearQueue.bind(coordinator),
    addToNext: coordinator.addToNext.bind(coordinator),
    addTracksToNext: coordinator.addTracksToNext.bind(coordinator),
    addToQueueEnd: coordinator.addToQueueEnd.bind(coordinator),
    addTracksToQueueEnd: coordinator.addTracksToQueueEnd.bind(coordinator),
    setRepeatOneEnabled: coordinator.setRepeatOneEnabled.bind(coordinator),
    setShuffleEnabled: coordinator.setShuffleEnabled.bind(coordinator),
  });
}

let sharedPlaybackSession: ReturnType<typeof createPlaybackSession> | null = null;

export function usePlaybackSession() {
  sharedPlaybackSession ??= createPlaybackSession();
  return sharedPlaybackSession;
}

import { invoke } from "@tauri-apps/api/core";
import { computed, readonly, ref, watch } from "vue";
import { PlaybackQueueCoordinator } from "@/playback/queue/coordinator";
import type { PlaybackQueueSnapshot, QueuePlaybackAttempt } from "@/playback/queue/coordinator";
import {
  createPlaybackQueueSnapshotWriter,
  EMPTY_PLAYBACK_QUEUE_SNAPSHOT,
  loadPlaybackQueueSnapshot,
} from "@/playback/queue/persistence";
import type { PlaybackQueuePersistenceSnapshot } from "@/playback/queue/persistence";
import { createPlaybackSessionCommands } from "@/playback/commands";
import { createPlaybackStatusObserver } from "@/playback/status";
import {
  createPlaybackState,
  type PlaybackCommandInvoker,
  type PlaybackStartFailure,
} from "@/playback/state";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";

export type { PlaybackStatus } from "@/playback/status";

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
  const playbackState = createPlaybackState(invokeCommand);
  const currentTrack = playbackState.currentTrack;
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
  ): Promise<QueuePlaybackAttempt> {
    while (isPlaybackCommandPending.value) {
      if (!canStart()) return { status: "cancelled" };
      await waitForPlaybackCommand();
    }
    if (!canStart()) return { status: "cancelled" };

    if (!(await playbackState.startTrack(trackId, canStart))) {
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

  const coordinator = new PlaybackQueueCoordinator(
    attemptPlayback,
    (snapshot, persistenceSnapshot) => {
      syncQueueState(snapshot);
      writeQueueSnapshot(persistenceSnapshot);
    },
    {
      stopPlayback: playbackState.stopPlayback,
      stopStalePlayback: playbackState.stopStalePlayback,
      finishPlayback: async (playbackId, canFinish) => {
        await playbackState.finishPlayback(playbackId, canFinish);
        if (canFinish()) await statusObserver.refreshAfterCommand();
      },
    },
  );
  coordinator.restoreQueue(initialQueueSnapshot);

  const statusObserver = createPlaybackStatusObserver({
    invokeCommand,
    currentTrack,
    isCommandPending: isPlaybackCommandPending,
    isSeeking,
    activeQueueRowKey,
    playbackError,
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
    playbackStatus: statusObserver.status,
    isPlaybackStatusSettled: statusObserver.isSettled,
    playbackError: readonly(playbackError),
    currentTrack: publicCurrentTrack,
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
  });

  return Object.freeze({
    state,
    refreshPlaybackStatus: statusObserver.refresh,
    ...commands,
    removeQueueItems: coordinator.removeQueueItems.bind(coordinator),
    removeTrackFromQueue: coordinator.removeTrackFromQueue.bind(coordinator),
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

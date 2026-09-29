import { computed, readonly, ref, watch } from "vue";
import { usePlaybackState } from "@/composables/usePlaybackState";
import { PlaybackQueueCoordinator } from "@/composables/playbackQueueCoordinator";
import {
  createPlaybackQueueSnapshotWriter,
  EMPTY_PLAYBACK_QUEUE_SNAPSHOT,
  loadPlaybackQueueSnapshot,
} from "@/composables/playbackQueuePersistence";
import type {
  PlaybackQueueSnapshot,
  PlaybackStatusObservation,
  QueuePlaybackAttempt,
} from "@/composables/playbackQueueCoordinator";
import type { PlaybackStartFailure } from "@/composables/usePlaybackState";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";

const restoredQueueSnapshot = loadPlaybackQueueSnapshot();
const initialQueueSnapshot = restoredQueueSnapshot ?? EMPTY_PLAYBACK_QUEUE_SNAPSHOT;
const restoredStartRowKey = restoredQueueSnapshot?.currentRowKey ?? null;
const writeQueueSnapshot = createPlaybackQueueSnapshotWriter(restoredQueueSnapshot);
const displayedTracks = ref<PlaybackDisplayTrack[]>([]);
const readonlyDisplayedTracks = readonly(displayedTracks);
const currentRowKey = ref<string | null>(null);
const readonlyCurrentRowKey = readonly(currentRowKey);
const queuePlaybackError = ref("");
const readonlyQueuePlaybackError = readonly(queuePlaybackError);
const repeatOneEnabled = ref(false);
const readonlyRepeatOneEnabled = readonly(repeatOneEnabled);
const shuffleEnabled = ref(false);
const readonlyShuffleEnabled = readonly(shuffleEnabled);
const canPlayPrevious = ref(false);
const readonlyCanPlayPrevious = readonly(canPlayPrevious);
const canPlayNext = ref(false);
const readonlyCanPlayNext = readonly(canPlayNext);
const {
  currentTrack,
  isPlaybackCommandPending,
  playbackStartError,
  playbackStartFailure,
  playTrack,
  stopPlayback,
  stopStalePlayback,
} = usePlaybackState();

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

  if (!(await playTrack(trackId, canStart))) {
    if (!canStart()) return { status: "cancelled" };
    const failure: PlaybackStartFailure = playbackStartFailure.value ?? {
      kind: "playback-failed",
      message: playbackStartError.value || "播放命令未执行",
    };
    playbackStartError.value = "";
    playbackStartFailure.value = null;
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

function syncQueueState(snapshot: PlaybackQueueSnapshot) {
  displayedTracks.value = [...snapshot.displayedTracks];
  currentRowKey.value = snapshot.currentRowKey;
  queuePlaybackError.value = snapshot.queuePlaybackError;
  repeatOneEnabled.value = snapshot.repeatOneEnabled;
  shuffleEnabled.value = snapshot.shuffleEnabled;
  canPlayPrevious.value = snapshot.canPlayPrevious;
  canPlayNext.value = snapshot.canPlayNext;
}

const coordinator = new PlaybackQueueCoordinator(
  attemptPlayback,
  (snapshot) => {
    syncQueueState(snapshot);
    writeQueueSnapshot(snapshot);
  },
  {
    stopPlayback,
    stopStalePlayback,
  },
);
coordinator.restoreQueue(initialQueueSnapshot);

const canStartRestoredQueue = computed(
  () =>
    restoredStartRowKey !== null &&
    currentRowKey.value === restoredStartRowKey &&
    displayedTracks.value.some((track) => track.rowKey === restoredStartRowKey),
);

function removeQueueItem(rowKey: string) {
  return coordinator.removeQueueItem(rowKey);
}

function replaceAndPlay(items: readonly PlaybackDisplayTrack[], startRowKey: string) {
  return coordinator.replaceAndPlay(items, startRowKey);
}

function playQueueItem(rowKey: string) {
  return coordinator.playQueueItem(rowKey);
}

function playRestoredQueue() {
  if (!canStartRestoredQueue.value || restoredStartRowKey === null) {
    return Promise.resolve(false);
  }
  return coordinator.playQueueItem(restoredStartRowKey);
}

function playPreviousTrack() {
  return coordinator.playPrevious();
}

function playNextTrack() {
  return coordinator.playNext();
}

function setRepeatOneEnabled(enabled: boolean) {
  coordinator.setRepeatOneEnabled(enabled);
}

function setShuffleEnabled(enabled: boolean) {
  coordinator.setShuffleEnabled(enabled);
}

function observePlaybackStatus(observation: PlaybackStatusObservation) {
  return coordinator.observePlaybackStatus(observation);
}

function invalidatePendingAdvance() {
  coordinator.invalidatePendingAdvance();
}

function suppressPlaybackEnd(playbackId: number | null) {
  coordinator.suppressPlaybackEnd(playbackId);
}

function allowPlaybackEnd(playbackId: number | null) {
  coordinator.allowPlaybackEnd(playbackId);
}

export function usePlaybackDisplayList() {
  return {
    displayedTracks: readonlyDisplayedTracks,
    currentRowKey: readonlyCurrentRowKey,
    canStartRestoredQueue,
    queuePlaybackError: readonlyQueuePlaybackError,
    repeatOneEnabled: readonlyRepeatOneEnabled,
    shuffleEnabled: readonlyShuffleEnabled,
    canPlayPrevious: readonlyCanPlayPrevious,
    canPlayNext: readonlyCanPlayNext,
    setRepeatOneEnabled,
    setShuffleEnabled,
    removeQueueItem,
    replaceAndPlay,
    playQueueItem,
    playRestoredQueue,
    playPreviousTrack,
    playNextTrack,
    observePlaybackStatus,
    invalidatePendingAdvance,
    suppressPlaybackEnd,
    allowPlaybackEnd,
  };
}

import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { usePlaybackDisplayList } from "@/composables/usePlaybackDisplayList";
import { usePlaybackState } from "@/composables/usePlaybackState";

const PLAYBACK_STATUS_POLL_INTERVAL_MS = 500;

type PlaybackStatus = {
  hasAudio: boolean;
  isPlaying: boolean;
  hasEnded: boolean;
  playbackId: number | null;
  positionMs: number;
  durationMs: number;
};

const EMPTY_PLAYBACK_STATUS = {
  hasAudio: false,
  isPlaying: false,
  hasEnded: false,
  playbackId: null,
  positionMs: 0,
  durationMs: 0,
} satisfies PlaybackStatus;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

export function usePlaybackControls(ensureCurrentVolumeIsSynchronized: () => Promise<boolean>) {
  const playbackStatus = ref<PlaybackStatus>({ ...EMPTY_PLAYBACK_STATUS });
  const playbackError = ref("");
  const isSeeking = ref(false);
  const selectedPositionMs = ref(0);
  const { currentTrack, isPlaybackCommandPending, playbackStartError, playTrack } =
    usePlaybackState();
  const {
    displayedTracks,
    currentRowKey,
    canStartRestoredQueue,
    queuePlaybackError,
    repeatOneEnabled,
    shuffleEnabled,
    canPlayPrevious,
    canPlayNext,
    setRepeatOneEnabled,
    setShuffleEnabled,
    playQueueItem,
    playRestoredQueue,
    playPreviousTrack,
    playNextTrack,
    observePlaybackStatus,
    invalidatePendingAdvance,
    suppressPlaybackEnd,
    allowPlaybackEnd,
  } = usePlaybackDisplayList();
  let playbackStatusPoll: ReturnType<typeof globalThis.setInterval> | null = null;
  let statusRequestsInFlight = 0;
  let statusRequestVersion = 0;

  async function refreshPlaybackStatus(force = false): Promise<boolean> {
    if (statusRequestsInFlight > 0 && !force) return false;

    statusRequestsInFlight += 1;
    const requestVersion = ++statusRequestVersion;
    try {
      const status = await invoke<PlaybackStatus>("playback_status");
      if (requestVersion !== statusRequestVersion) return false;

      playbackStatus.value = status;
      await observePlaybackStatus({
        status,
        currentPlaybackId: currentTrack.value?.playbackId ?? null,
        currentTrackId: currentTrack.value?.trackId ?? null,
        isCommandPending: isPlaybackCommandPending.value,
        isSeeking: isSeeking.value,
      });
      if (playbackError.value.startsWith("Playback status unavailable:")) playbackError.value = "";
      return true;
    } catch (error) {
      if (requestVersion === statusRequestVersion) {
        playbackError.value = `Playback status unavailable: ${errorMessage(error)}`;
      }
      return false;
    } finally {
      statusRequestsInFlight -= 1;
    }
  }

  async function togglePlayback() {
    if (isPlaybackCommandPending.value || isSeeking.value) return;

    invalidatePendingAdvance();
    isPlaybackCommandPending.value = true;
    try {
      if (!(await refreshPlaybackStatus(true))) return;
      const status = playbackStatus.value;
      if (
        !status.hasAudio ||
        (!status.isPlaying && status.durationMs > 0 && status.positionMs >= status.durationMs)
      ) {
        const track = currentTrack.value;
        const shouldStartRestoredQueue =
          canStartRestoredQueue.value && (track === null || track.playbackId === null);
        if ((!track && !shouldStartRestoredQueue) || !(await ensureCurrentVolumeIsSynchronized())) {
          return;
        }
        if (
          !shouldStartRestoredQueue &&
          track !== null &&
          currentTrack.value?.playbackId !== track.playbackId
        ) {
          return;
        }

        isPlaybackCommandPending.value = false;
        let started: boolean;
        if (shouldStartRestoredQueue) {
          started = await playRestoredQueue();
        } else if (track !== null) {
          const rowKey = currentRowKey.value;
          const queueItem = displayedTracks.value.find((item) => item.rowKey === rowKey);
          started =
            rowKey && queueItem?.trackId === track.trackId
              ? await playQueueItem(rowKey)
              : await playTrack(
                  track.trackId,
                  () => currentTrack.value?.playbackId === track.playbackId,
                );
        } else {
          started = false;
        }
        isPlaybackCommandPending.value = true;
        if (!started) {
          await refreshPlaybackStatus(true);
          return;
        }
      } else if (status.isPlaying) {
        await invoke("pause");
        suppressPlaybackEnd(currentTrack.value?.playbackId ?? status.playbackId);
      } else {
        await invoke("resume");
        allowPlaybackEnd(currentTrack.value?.playbackId ?? status.playbackId);
      }

      playbackError.value = "";
      playbackStartError.value = "";
      await refreshPlaybackStatus(true);
    } catch (error) {
      playbackError.value = `Playback command failed: ${errorMessage(error)}`;
      await refreshPlaybackStatus(true);
    } finally {
      isPlaybackCommandPending.value = false;
    }
  }

  function handleSeekInput(event: InstanceType<typeof globalThis.Event>) {
    selectedPositionMs.value = Number(
      (event.target as InstanceType<typeof globalThis.HTMLInputElement>).value,
    );
    isSeeking.value = true;
  }

  async function commitSeek() {
    if (!isSeeking.value || isPlaybackCommandPending.value) return;

    invalidatePendingAdvance();
    isPlaybackCommandPending.value = true;
    try {
      await invoke("seek_to", { positionMs: selectedPositionMs.value });
      playbackError.value = "";
      playbackStartError.value = "";
    } catch (error) {
      playbackError.value = `Seek failed: ${errorMessage(error)}`;
    } finally {
      isSeeking.value = false;
      isPlaybackCommandPending.value = false;
    }

    await refreshPlaybackStatus(true);
    selectedPositionMs.value = playbackStatus.value.positionMs;
  }

  watch(
    currentTrack,
    (track) => {
      if (!track) {
        statusRequestVersion += 1;
        playbackStatus.value = { ...EMPTY_PLAYBACK_STATUS };
        selectedPositionMs.value = 0;
        return;
      }
      void refreshPlaybackStatus(true);
    },
    { flush: "sync" },
  );

  onMounted(() => {
    void refreshPlaybackStatus();
    playbackStatusPoll = globalThis.setInterval(
      () => void refreshPlaybackStatus(),
      PLAYBACK_STATUS_POLL_INTERVAL_MS,
    );
  });

  onUnmounted(() => {
    if (playbackStatusPoll !== null) globalThis.clearInterval(playbackStatusPoll);
    statusRequestVersion += 1;
  });

  return {
    playbackStatus,
    playbackError,
    isSeeking,
    selectedPositionMs,
    currentTrack,
    isPlaybackCommandPending,
    playbackStartError,
    queuePlaybackError,
    canStartRestoredQueue,
    repeatOneEnabled,
    shuffleEnabled,
    canPlayPrevious,
    canPlayNext,
    setRepeatOneEnabled,
    setShuffleEnabled,
    playPreviousTrack,
    playNextTrack,
    togglePlayback,
    handleSeekInput,
    commitSeek,
  };
}

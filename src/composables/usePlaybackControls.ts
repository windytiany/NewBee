import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { usePlaybackState } from "@/composables/usePlaybackState";

const PLAYBACK_STATUS_POLL_INTERVAL_MS = 500;

type PlaybackStatus = {
  hasAudio: boolean;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
};

const EMPTY_PLAYBACK_STATUS = {
  hasAudio: false,
  isPlaying: false,
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

    isPlaybackCommandPending.value = true;
    try {
      if (!(await refreshPlaybackStatus(true))) return;
      const status = playbackStatus.value;
      if (
        !status.hasAudio ||
        (!status.isPlaying && status.durationMs > 0 && status.positionMs >= status.durationMs)
      ) {
        const track = currentTrack.value;
        if (!track || !(await ensureCurrentVolumeIsSynchronized())) return;

        isPlaybackCommandPending.value = false;
        const started = await playTrack(track.trackId);
        isPlaybackCommandPending.value = true;
        if (!started) {
          await refreshPlaybackStatus(true);
          return;
        }
      } else if (status.isPlaying) {
        await invoke("pause");
      } else {
        await invoke("resume");
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

    isPlaybackCommandPending.value = true;
    try {
      await invoke("seek_to", { positionMs: selectedPositionMs.value });
      playbackError.value = "";
      playbackStartError.value = "";
      await refreshPlaybackStatus(true);
    } catch (error) {
      playbackError.value = `Seek failed: ${errorMessage(error)}`;
      await refreshPlaybackStatus(true);
    } finally {
      isSeeking.value = false;
      selectedPositionMs.value = playbackStatus.value.positionMs;
      isPlaybackCommandPending.value = false;
    }
  }

  watch(currentTrack, () => void refreshPlaybackStatus(true));

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
    togglePlayback,
    handleSeekInput,
    commitSeek,
  };
}

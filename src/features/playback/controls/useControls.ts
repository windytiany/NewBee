import { onMounted, onUnmounted, ref, watch } from "vue";
import { PLAYBACK_STATUS_POLL_INTERVAL_MS, usePlaybackSession } from "@/features/playback/session";

export function usePlaybackControls() {
  const session = usePlaybackSession();
  const isSeeking = session.state.isSeeking;
  const isSeekInputActive = ref(false);
  const selectedPositionMs = ref(0);
  let playbackStatusPoll: ReturnType<typeof globalThis.setInterval> | null = null;

  watch(
    isSeeking,
    (seeking) => {
      if (!seeking) isSeekInputActive.value = false;
    },
    { flush: "sync" },
  );

  function handleSeekInput(event: InstanceType<typeof globalThis.Event>) {
    if (!isSeeking.value) session.beginSeeking();
    isSeekInputActive.value = true;
    selectedPositionMs.value = Number(
      (event.target as InstanceType<typeof globalThis.HTMLInputElement>).value,
    );
  }

  async function commitSeek() {
    if (!isSeekInputActive.value) return;
    isSeekInputActive.value = false;

    try {
      await session.seekTo(selectedPositionMs.value);
    } finally {
      isSeekInputActive.value = false;
      selectedPositionMs.value = session.state.playbackStatus.value.positionMs;
    }
  }

  onMounted(() => {
    void session.refreshPlaybackStatus();
    playbackStatusPoll = globalThis.setInterval(
      () => void session.refreshPlaybackStatus(),
      PLAYBACK_STATUS_POLL_INTERVAL_MS,
    );
  });

  onUnmounted(() => {
    if (playbackStatusPoll !== null) globalThis.clearInterval(playbackStatusPoll);
  });

  return {
    ...session.state,
    isSeekInputActive,
    selectedPositionMs,
    setRepeatOneEnabled: session.setRepeatOneEnabled,
    setShuffleEnabled: session.setShuffleEnabled,
    playPreviousTrack: session.playPreviousTrack,
    playNextTrack: session.playNextTrack,
    togglePlayback: session.togglePlayback,
    handleSeekInput,
    commitSeek,
  };
}

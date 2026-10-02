import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { createSystemMediaCommandHandler, type SystemMediaCommand } from "@/playback/systemMedia";
import type { PlaybackTransition } from "@/playback/state";
import { PLAYBACK_STATUS_POLL_INTERVAL_MS, usePlaybackSession } from "@/playback/session";

export function usePlaybackControls(ensureCurrentVolumeIsSynchronized: () => Promise<boolean>) {
  const session = usePlaybackSession();
  const isSeeking = session.state.isSeeking;
  const isSeekInputActive = ref(false);
  const selectedPositionMs = ref(0);
  let playbackStatusPoll: ReturnType<typeof globalThis.setInterval> | null = null;
  let unlistenSystemMedia: UnlistenFn | null = null;
  let unlistenTrackTransition: UnlistenFn | null = null;
  let isUnmounted = false;
  const handleSystemMediaCommand = createSystemMediaCommandHandler({
    isCommandPending: () => session.state.isPlaybackCommandPending.value || isSeeking.value,
    isPlaying: () => session.state.playbackStatus.value.isPlaying,
    canPlayPrevious: () => session.state.canPlayPrevious.value,
    canPlayNext: () => session.state.canPlayNext.value,
    refreshStatus: session.refreshPlaybackStatus,
    togglePlayback: () => session.togglePlayback(ensureCurrentVolumeIsSynchronized),
    playPrevious: session.playPreviousTrack,
    playNext: session.playNextTrack,
  });

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
    if (!isSeekInputActive.value || session.state.isPlaybackCommandPending.value) return;

    try {
      await session.seekTo(selectedPositionMs.value);
    } finally {
      isSeekInputActive.value = false;
      selectedPositionMs.value = session.state.playbackStatus.value.positionMs;
    }
  }

  onMounted(() => {
    void listen<PlaybackTransition>("playback-track-started", ({ payload }) => {
      session.observePlaybackTransition(payload);
    })
      .then((unlisten) => {
        if (isUnmounted) unlisten();
        else unlistenTrackTransition = unlisten;
      })
      .catch((error: unknown) => {
        globalThis.console.error("Could not listen for track transitions.", error);
      });
    void listen<SystemMediaCommand>("system-media-command", ({ payload }) => {
      void handleSystemMediaCommand(payload).catch((error: unknown) => {
        globalThis.console.error("Could not handle Windows media command.", error);
      });
    })
      .then((unlisten) => {
        if (isUnmounted) unlisten();
        else unlistenSystemMedia = unlisten;
      })
      .catch((error: unknown) => {
        globalThis.console.error("Could not listen for Windows media commands.", error);
      });
    void session.refreshPlaybackStatus();
    playbackStatusPoll = globalThis.setInterval(
      () => void session.refreshPlaybackStatus(),
      PLAYBACK_STATUS_POLL_INTERVAL_MS,
    );
  });

  onUnmounted(() => {
    isUnmounted = true;
    unlistenSystemMedia?.();
    unlistenTrackTransition?.();
    if (playbackStatusPoll !== null) globalThis.clearInterval(playbackStatusPoll);
  });

  return {
    ...session.state,
    selectedPositionMs,
    setRepeatOneEnabled: session.setRepeatOneEnabled,
    setShuffleEnabled: session.setShuffleEnabled,
    playPreviousTrack: session.playPreviousTrack,
    playNextTrack: session.playNextTrack,
    togglePlayback: () => session.togglePlayback(ensureCurrentVolumeIsSynchronized),
    handleSeekInput,
    commitSeek,
  };
}

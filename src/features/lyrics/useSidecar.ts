import { invoke } from "@tauri-apps/api/core";
import { effectScope, onScopeDispose, readonly, ref, watch, type Ref } from "vue";
import { usePlaybackSession } from "@/features/playback/session";
import { logger } from "@/shared/logging/logger";
import type { PlaybackCommandInvoker } from "@/features/playback/types";
import type { TrackLyrics } from "@/features/lyrics/types";

type SidecarOptions = {
  currentTrack: Readonly<Ref<Readonly<{ trackId: number | null }> | null>>;
  currentPlaybackId: Readonly<Ref<number | null>>;
  invokeCommand?: PlaybackCommandInvoker;
};

export function useSidecar(options: SidecarOptions) {
  const invokeCommand = options.invokeCommand ?? invoke;
  const lyrics = ref<TrackLyrics | null>(null);
  let requestVersion = 0;
  const stop = watch(
    () => [options.currentTrack.value?.trackId ?? null, options.currentPlaybackId.value] as const,
    ([trackId, playbackId], previous) => {
      if (trackId === previous?.[0] && playbackId === previous?.[1]) return;
      // Editing detaches the audio instance, but retains the listening lyrics.
      if (trackId !== null && trackId === previous?.[0] && playbackId === null) return;
      const version = ++requestVersion;
      lyrics.value = null;
      if (trackId === null || playbackId === null) return;
      void invokeCommand<TrackLyrics | null>("get_playback_sidecar_lyrics", { trackId })
        .then((result) => {
          if (version === requestVersion) lyrics.value = result;
        })
        .catch((error: unknown) =>
          logger.warn("lyrics", "sidecar_read_failed", error, { trackId }),
        );
    },
    { immediate: true, flush: "sync" },
  );
  onScopeDispose(() => {
    stop();
    requestVersion++;
  });
  return readonly(lyrics);
}

let playbackLyrics: ReturnType<typeof useSidecar> | null = null;

export function usePlaybackLyrics() {
  if (!playbackLyrics) {
    const { currentTrack, currentPlaybackId } = usePlaybackSession().state;
    // Playback lyrics outlive the now-playing page and follow the WebView session.
    const scope = effectScope(true);
    playbackLyrics = scope.run(() => useSidecar({ currentTrack, currentPlaybackId }))!;
  }
  return playbackLyrics;
}

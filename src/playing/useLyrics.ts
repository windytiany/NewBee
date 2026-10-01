import { invoke } from "@tauri-apps/api/core";
import { computed, onScopeDispose, readonly, ref, watch } from "vue";
import type { Ref } from "vue";
import type { PlaybackCommandInvoker } from "@/playback/state";
import type { PlaybackStatus } from "@/playback/status";
import type { LyricLine, TrackLyrics } from "@/playing/types";
import { notify } from "@/notification/center";

export type PlayingLyricsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; lyrics: TrackLyrics }
  | { status: "error"; message: string };

export type ActiveLyricIndices = {
  activeIndex: number;
  activeGroupStartIndex: number;
};

export type PlayingLyricsOptions = {
  currentTrack: Readonly<Ref<Readonly<{ trackId: number }> | null>>;
  playbackStatus: Readonly<Ref<PlaybackStatus>>;
  invokeCommand?: PlaybackCommandInvoker;
};

export function getActiveLyricIndices(
  lines: readonly LyricLine[],
  positionMs: number,
): ActiveLyricIndices {
  let activeIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startMs <= positionMs) activeIndex = index;
  }

  if (activeIndex === -1) return { activeIndex, activeGroupStartIndex: -1 };

  const activeStartMs = lines[activeIndex].startMs;
  return {
    activeIndex,
    activeGroupStartIndex: lines.findIndex((line) => line.startMs === activeStartMs),
  };
}

export function usePlayingLyrics(options: PlayingLyricsOptions) {
  const invokeCommand = options.invokeCommand ?? invoke;
  const lyricsState = ref<PlayingLyricsState>({ status: "idle" });
  const syncedLines = computed<readonly LyricLine[] | null>(() => {
    const state = lyricsState.value;
    return state.status === "ready" && state.lyrics.kind === "synced" ? state.lyrics.lines : null;
  });
  const activeIndices = computed(() => {
    const lines = syncedLines.value;
    return lines === null
      ? { activeIndex: -1, activeGroupStartIndex: -1 }
      : getActiveLyricIndices(lines, options.playbackStatus.value.positionMs);
  });
  const activeLine = computed<LyricLine | null>(() => {
    const lines = syncedLines.value;
    return lines === null ? null : (lines[activeIndices.value.activeIndex] ?? null);
  });
  const activeGroupStartLine = computed<LyricLine | null>(() => {
    const lines = syncedLines.value;
    return lines === null ? null : (lines[activeIndices.value.activeGroupStartIndex] ?? null);
  });
  let requestVersion = 0;

  async function loadLyrics(trackId: number, version: number) {
    let outcome!: { status: "ready"; lyrics: TrackLyrics } | { status: "error"; message: string };
    try {
      outcome = {
        status: "ready",
        lyrics: await invokeCommand<TrackLyrics>("get_track_lyrics", { trackId }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
      outcome = { status: "error", message };
    } finally {
      if (version === requestVersion) {
        if (outcome.status === "error") {
          notify({
            type: "error",
            message: `歌词读取失败：${outcome.message}`,
            key: `track-lyrics:${trackId}`,
          });
        }
        lyricsState.value =
          outcome.status === "ready"
            ? { status: "ready", lyrics: outcome.lyrics }
            : { status: "error", message: outcome.message };
      }
    }
  }

  watch(
    () => options.currentTrack.value?.trackId ?? null,
    (trackId) => {
      const version = ++requestVersion;
      if (trackId === null) {
        lyricsState.value = { status: "idle" };
        return;
      }

      lyricsState.value = { status: "loading" };
      void loadLyrics(trackId, version);
    },
    { flush: "sync", immediate: true },
  );

  onScopeDispose(() => {
    requestVersion += 1;
  });

  return Object.freeze({
    state: readonly(lyricsState),
    activeIndex: computed(() => activeIndices.value.activeIndex),
    activeGroupStartIndex: computed(() => activeIndices.value.activeGroupStartIndex),
    activeLine,
    activeGroupStartLine,
  });
}

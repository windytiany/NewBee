import { invoke } from "@tauri-apps/api/core";
import { createLyricsApi } from "@/features/lyrics/api";
import { computed, onScopeDispose, readonly, ref, watch } from "vue";
import type { Ref } from "vue";
import type { PlaybackCommandInvoker, PlaybackStatus } from "@/features/playback/types";

import type { LyricLine, TrackLyrics } from "@/features/lyrics/types";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";

export type LyricsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; lyrics: TrackLyrics }
  | { status: "error"; message: string };

export type ActiveLyricIndices = {
  activeIndex: number;
  activeGroupStartIndex: number;
};

export type LyricsOptions = {
  currentTrack: Readonly<Ref<Readonly<{ trackId: number }> | null>>;
  playbackStatus: Readonly<Ref<PlaybackStatus>>;
  invokeCommand?: PlaybackCommandInvoker;
  sidecarLyrics?: Readonly<Ref<TrackLyrics | null>>;
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

// Concurrent consumers share only the in-flight read, not a cached failure.
const pendingReads = new WeakMap<
  PlaybackCommandInvoker,
  Map<
    number,
    {
      promise: Promise<TrackLyrics>;
      notified: boolean;
      logged: boolean;
    }
  >
>();

export function useLyrics(options: LyricsOptions) {
  const invokeCommand = options.invokeCommand ?? invoke;
  const api = createLyricsApi(invokeCommand);
  const lyricsState = ref<LyricsState>({ status: "idle" });
  const displayState = computed<LyricsState>(() => {
    const sidecar = options.sidecarLyrics?.value;
    return sidecar ? { status: "ready", lyrics: sidecar } : lyricsState.value;
  });
  const syncedLines = computed<readonly LyricLine[] | null>(() => {
    const state = displayState.value;
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
    let reads = pendingReads.get(invokeCommand);
    if (!reads) {
      reads = new Map();
      pendingReads.set(invokeCommand, reads);
    }
    let request = reads.get(trackId);
    if (!request) {
      let promise: Promise<TrackLyrics>;
      try {
        promise = api.read(trackId);
      } catch (error) {
        promise = Promise.reject(error);
      }
      request = { promise, notified: false, logged: false };
      reads.set(trackId, request);
      const currentReads = reads;
      const currentRequest = request;
      const release = () => {
        if (currentReads.get(trackId) === currentRequest) currentReads.delete(trackId);
      };
      void request.promise.then(release, release);
    }
    let outcome!: { status: "ready"; lyrics: TrackLyrics } | { status: "error"; message: string };
    try {
      outcome = {
        status: "ready",
        lyrics: await request.promise,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
      outcome = { status: "error", message };
    } finally {
      if (version === requestVersion) {
        if (outcome.status === "error") {
          if (!request.logged) {
            request.logged = true;
            logger.warn("lyrics", "read_failed", outcome.message, { trackId });
          }
          if (!request.notified && !options.sidecarLyrics?.value) {
            request.notified = true;
            notify({
              type: "warning",
              message: "读取歌词失败，请查看日志",
              key: `lyrics-read:${trackId}`,
            });
          }
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

  function reloadCurrentLyrics() {
    const trackId = options.currentTrack.value?.trackId;
    if (trackId === undefined) return;
    lyricsState.value = { status: "loading" };
    void loadLyrics(trackId, ++requestVersion);
  }
  globalThis.window?.addEventListener(LIBRARY_CHANGED_EVENT, reloadCurrentLyrics);

  onScopeDispose(() => {
    globalThis.window?.removeEventListener(LIBRARY_CHANGED_EVENT, reloadCurrentLyrics);
    requestVersion += 1;
  });

  return Object.freeze({
    retry: reloadCurrentLyrics,
    state: readonly(displayState),
    activeIndex: computed(() => activeIndices.value.activeIndex),
    activeGroupStartIndex: computed(() => activeIndices.value.activeGroupStartIndex),
    activeLine,
    activeGroupStartLine,
  });
}

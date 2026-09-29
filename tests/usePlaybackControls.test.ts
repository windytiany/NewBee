// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { describe, expect, it, mock } from "bun:test";

const STORAGE_KEY = "newbee.playback-queue";
const CURRENT_TRACK_STORAGE_KEY = "newbee.current-track";
const storedValues = new Map<string, string>();
const playbackAttempts: number[] = [];
let nextPlaybackId = 0;

const localStorage = {
  getItem(key: string) {
    return storedValues.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    storedValues.set(key, value);
  },
  removeItem(key: string) {
    storedValues.delete(key);
  },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage,
});

storedValues.set(
  STORAGE_KEY,
  JSON.stringify({
    version: 1,
    displayedTracks: [
      { rowKey: "before", trackId: 11, title: "Before", album: null, durationMs: 1000 },
      {
        rowKey: "restored-selection",
        trackId: 22,
        title: "Selected",
        album: null,
        durationMs: 2000,
      },
      { rowKey: "after", trackId: 33, title: "After", album: null, durationMs: 3000 },
    ],
    currentRowKey: "restored-selection",
    shuffleEnabled: true,
    repeatOneEnabled: true,
  }),
);
storedValues.set(
  CURRENT_TRACK_STORAGE_KEY,
  JSON.stringify({ trackId: 999, title: "Old track", artist: "Old artist" }),
);

const invoke = mock(async (command: string, args: { trackId?: number } = {}) => {
  if (command === "playback_status") {
    return {
      hasAudio: false,
      isPlaying: false,
      hasEnded: false,
      playbackId: null,
      positionMs: 0,
      durationMs: 0,
    };
  }
  if (command === "play_track") {
    const trackId = args.trackId;
    if (trackId === undefined) throw new Error("missing track ID");
    playbackAttempts.push(trackId);
    return {
      trackId,
      title: "Started queue track",
      artist: "Artist",
      playbackId: ++nextPlaybackId,
    };
  }
  throw new Error(`Unexpected playback command: ${command}`);
});

mock.module("@tauri-apps/api/core", () => ({ invoke }));

const { usePlaybackControls } = await import("@/composables/usePlaybackControls");
const { usePlaybackState } = await import("@/composables/usePlaybackState");

describe("restored queue playback controls", () => {
  it("does not autoplay and starts from the saved row despite a missing or mismatched current track", async () => {
    const originalConsoleWarn = globalThis.console.warn;
    globalThis.console.warn = () => {};
    try {
      const controls = usePlaybackControls(async () => true);
      const playbackState = usePlaybackState();

      expect(playbackAttempts).toEqual([]);
      expect(controls.currentTrack.value?.trackId).toBe(999);
      expect(controls.canStartRestoredQueue.value).toBe(true);
      expect(controls.shuffleEnabled.value).toBe(true);
      expect(controls.repeatOneEnabled.value).toBe(true);

      await controls.togglePlayback();
      expect(playbackAttempts).toEqual([22]);

      playbackState.currentTrack.value = null;
      await controls.togglePlayback();
      expect(playbackAttempts).toEqual([22, 22]);
    } finally {
      globalThis.console.warn = originalConsoleWarn;
    }
  });
});

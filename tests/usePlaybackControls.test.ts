// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { describe, expect, it, mock } from "bun:test";

const storedValues = new Map<string, string>();
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

const invoke = mock(async (command: string) => {
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
  throw new Error(`Unexpected playback command: ${command}`);
});

mock.module("@tauri-apps/api/core", () => ({ invoke }));

const { usePlaybackControls } = await import("@/playback/useControls");

describe("playback controls progress input", () => {
  it("keeps the slider's temporary position in the playback bar", () => {
    const originalConsoleWarn = globalThis.console.warn;
    globalThis.console.warn = () => {};
    try {
      const controls = usePlaybackControls(async () => true);
      controls.handleSeekInput({ target: { value: "375" } } as unknown as InstanceType<
        typeof globalThis.Event
      >);

      expect(controls.isSeeking.value).toBe(true);
      expect(controls.selectedPositionMs.value).toBe(375);
      expect(controls.playbackStatus.value.positionMs).toBe(0);
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      globalThis.console.warn = originalConsoleWarn;
    }
  });
});

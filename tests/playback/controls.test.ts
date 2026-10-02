import { afterEach, describe, expect, it, mock } from "bun:test";
import * as Vue from "vue";
import { createPlaybackSession, PLAYBACK_STATUS_POLL_INTERVAL_MS } from "@/playback/session";
import * as systemMedia from "@/playback/systemMedia";
import { evaluateModule, transpileScript } from "../support/moduleLoader";

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
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
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
let session: ReturnType<typeof createPlaybackSession>;
const { usePlaybackControls } = evaluateModule<typeof import("@/playback/useControls")>(
  transpileScript(
    await Bun.file(new URL("../../src/playback/useControls.ts", import.meta.url)).text(),
  ),
  {
    vue: Vue,
    "@tauri-apps/api/event": {
      listen: () => {
        throw new Error("Unmounted playback controls should not subscribe to desktop events.");
      },
    },
    "@/playback/systemMedia": systemMedia,
    "@/playback/session": {
      PLAYBACK_STATUS_POLL_INTERVAL_MS,
      usePlaybackSession: () => session,
    },
  },
);

describe("playback controls progress input", () => {
  it("keeps the slider's temporary position in the playback bar", () => {
    const originalConsoleWarn = globalThis.console.warn;
    const scope = Vue.effectScope();
    globalThis.console.warn = () => {};
    try {
      const controls = scope.run(() => {
        session = createPlaybackSession({
          invokeCommand: async <Result>(command: string) => (await invoke(command)) as Result,
          restoredQueueSnapshot: null,
        });
        return usePlaybackControls(async () => true);
      });
      if (!controls) throw new Error("Playback controls were not created.");
      controls.handleSeekInput({ target: { value: "375" } } as unknown as Event);

      expect(controls.isSeeking.value).toBe(true);
      expect(controls.selectedPositionMs.value).toBe(375);
      expect(controls.playbackStatus.value.positionMs).toBe(0);
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      scope.stop();
      globalThis.console.warn = originalConsoleWarn;
    }
  });
});

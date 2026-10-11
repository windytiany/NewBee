import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import {
  type createPlaybackSession,
  PLAYBACK_STATUS_POLL_INTERVAL_MS,
} from "@/features/playback/session";
import { playbackFixture } from "../../../support/playback/session";
import { transpileScript, evaluateSource } from "../../../support/module/loader";

let session: ReturnType<typeof createPlaybackSession>;
const { usePlaybackControls } = evaluateSource<
  typeof import("@/features/playback/controls/useControls")
>(
  transpileScript(
    await Bun.file(
      new URL("../../../../src/features/playback/controls/useControls.ts", import.meta.url),
    ).text(),
  ),
  {
    vue: Vue,
    "@tauri-apps/api/event": {
      listen: () => {
        throw new Error("Unmounted playback controls should not subscribe to desktop events.");
      },
    },
    "@/features/playback/session": {
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
      const fixture = playbackFixture();
      const controls = scope.run(() => {
        session = fixture.session;
        return usePlaybackControls();
      });
      if (!controls) throw new Error("Playback controls were not created.");
      const event = new Event("input");
      Object.defineProperty(event, "target", { value: { value: "375" } });
      controls.handleSeekInput(event);

      expect(controls.isSeeking.value).toBe(true);
      expect(controls.selectedPositionMs.value).toBe(375);
      expect(controls.playbackStatus.value.positionMs).toBe(0);
      expect(fixture.commands.map((command) => command.action)).toEqual(["beginSeeking"]);
    } finally {
      scope.stop();
      globalThis.console.warn = originalConsoleWarn;
    }
  });
});

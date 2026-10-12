import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import {
  type createPlaybackSession,
  PLAYBACK_STATUS_POLL_INTERVAL_MS,
} from "@/features/playback/session";
import { playbackFixture, playbackReply } from "../../../support/playback/session";
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
  it("commits an Inbox seek released while beginSeeking is pending", async () => {
    const originalConsoleWarn = globalThis.console.warn;
    const scope = Vue.effectScope();
    globalThis.console.warn = () => {};
    try {
      const fixture = playbackFixture();
      session = fixture.session;
      await session.ready;
      await session.playTracks(
        [
          {
            trackId: null,
            path: "C:/inbox/song.flac",
            rowKey: "inbox:1",
            title: "Song",
            album: null,
            durationMs: 1000,
          },
        ],
        "inbox:1",
      );
      const controls = scope.run(() => usePlaybackControls());
      if (!controls) throw new Error("Playback controls were not created.");
      let release!: () => void;
      fixture.defer(
        new Promise((resolve) => {
          release = () => resolve(playbackReply(fixture.snapshot));
        }),
      );
      const event = new Event("input");
      Object.defineProperty(event, "target", { value: { value: "375" } });
      controls.handleSeekInput(event);
      fixture.emit({ isCommandPending: true });
      const committed = controls.commitSeek();
      expect(controls.isSeekInputActive.value).toBe(false);
      await controls.commitSeek();
      fixture.emit({ isCommandPending: false });
      release();
      await committed;
      expect(fixture.commands[fixture.commands.length - 1]).toEqual({
        action: "seek",
        positionMs: 375,
        playbackId: 1,
      });
      expect(controls.isSeeking.value).toBe(false);
      expect(controls.isPlaybackCommandPending.value).toBe(false);
      expect(controls.playbackStatus.value.positionMs).toBe(375);
      expect(fixture.commands.filter((command) => command.action === "seek")).toHaveLength(1);
    } finally {
      scope.stop();
      globalThis.console.warn = originalConsoleWarn;
    }
  });
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

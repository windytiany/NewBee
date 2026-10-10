import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectScope } from "vue";
import { playbackFixture } from "../../support/playbackSession";
import { useLyrics } from "@/features/lyrics/composables/useLyrics";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import type { PlaybackDisplayTrack } from "@/features/playback/types";
import type { TrackLyrics } from "@/features/lyrics/types";

const tracks: PlaybackDisplayTrack[] = [1, 2].map((trackId) => ({
  trackId,
  rowKey: String(trackId),
  title: String(trackId),
  album: null,
  durationMs: 10000,
}));
const original: TrackLyrics = {
  kind: "synced",
  lines: [{ startMs: 1000, text: "sidecar original" }],
};
const changed: TrackLyrics = {
  kind: "synced",
  lines: [{ startMs: 2000, text: "sidecar changed" }],
};
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

for (const validSidecar of [true, false]) {
  it(`session controls and embedded saving preserve ${validSidecar ? "sidecar" : "fallback"} display without rereading files`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "newbee-session-lrc-"));
    const path = join(directory, "1.lrc");
    const initialText = validSidecar ? "[00:01]sidecar original" : "";
    writeFileSync(path, initialText);
    writeFileSync(join(directory, "2.lrc"), "[00:02]sidecar changed");
    const reads: number[] = [];
    let embedded: TrackLyrics = { kind: "instrumental" };
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const window = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: window });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    const fixture = playbackFixture({
      invokeExtra: (command, args) => {
        if (command === "set_tracks_skipped") return;
        if (command === "get_track_lyrics") return embedded;
        if (command === "get_playback_sidecar_lyrics") {
          const id = args?.trackId;
          if (typeof id !== "number") throw new Error("Missing trackId");
          reads.push(id);
          const text = readFileSync(join(directory, `${id}.lrc`), "utf8");
          // Command boundary adapter for the real fixture. Rust IPC tests verify parsing.
          return text === "[00:01]sidecar original"
            ? original
            : text === "[00:02]sidecar changed"
              ? changed
              : null;
        }
        throw new Error(`Unexpected command ${command}`);
      },
    });
    const { session, invokeCommand } = fixture;
    const scope = effectScope();
    try {
      const lyrics = scope.run(() =>
        useLyrics({
          currentTrack: session.state.currentTrack,
          playbackStatus: session.state.playbackStatus,
          sidecarLyrics: session.state.sidecarLyrics,
          invokeCommand,
        }),
      )!;
      await session.playTracks(tracks, "1");
      await settle();
      expect(fixture.calls).toContain("playTracks");
      expect(reads).toEqual([1]);
      expect(lyrics.state.value).toEqual({
        status: "ready",
        lyrics: validSidecar ? original : { kind: "instrumental" },
      });
      writeFileSync(path, "[00:02]sidecar changed");
      await session.togglePlayback();
      await session.togglePlayback();
      session.beginSeeking();
      expect(await session.seekTo(3000)).toBe(true);
      expect(
        fixture.commands
          .filter((command) => command.action === "seek")
          .map((command) => command.positionMs),
      ).toEqual([3000]);
      expect(lyrics.state.value).toEqual({
        status: "ready",
        lyrics: validSidecar ? original : { kind: "instrumental" },
      });
      expect(reads).toEqual([1]);
      await session.withMetadataEditing([1], async () => {
        embedded = { kind: "plain", text: "saved embedded" };
        window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
      });
      await settle();
      expect(lyrics.state.value).toEqual({
        status: "ready",
        lyrics: validSidecar ? original : embedded,
      });
      expect(reads).toEqual([1]);
      expect(readFileSync(path, "utf8")).toBe("[00:02]sidecar changed");
      await session.playQueueItem("1");
      await settle();
      expect(reads).toEqual([1, 1]);
      expect(lyrics.state.value).toEqual({ status: "ready", lyrics: changed });
      fixture.emit({
        currentPlaybackId: session.state.currentPlaybackId.value! + 1,
        currentRowKey: "2",
        currentTrack: { trackId: 2, title: "two", artist: null },
      });
      await settle();
      expect(reads).toEqual([1, 1, 2]);
      expect(lyrics.state.value).toEqual({ status: "ready", lyrics: changed });
    } finally {
      scope.stop();
      rmSync(directory, { recursive: true });
      if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
      else Reflect.deleteProperty(globalThis, "localStorage");
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
}

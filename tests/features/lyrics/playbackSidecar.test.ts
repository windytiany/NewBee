import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectScope } from "vue";
import { createPlaybackSession } from "@/features/playback/session";
import { useLyrics } from "@/features/lyrics/composables/useLyrics";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import type { PlaybackCommandInvoker, PlaybackDisplayTrack } from "@/features/playback/types";
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
    const preparations: number[] = [];
    let embedded: TrackLyrics = { kind: "instrumental" };
    let playbackId = 0;
    let isPlaying = true;
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const window = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: window });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    const invokeCommand: PlaybackCommandInvoker = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => {
      if (command === "list_skipped_track_ids") return [] as T;
      if (command === "play_track")
        return {
          trackId: args?.trackId,
          playbackId: ++playbackId,
          title: "song",
          artist: null,
        } as T;
      if (command === "prepare_next_track") {
        if (typeof args?.trackId === "number") preparations.push(args.trackId);
        return true as T;
      }
      if (command === "playback_status")
        return {
          hasAudio: true,
          playbackId,
          isPlaying,
          hasEnded: false,
          positionMs: 0,
          durationMs: 10000,
        } as T;
      if (command === "pause") {
        isPlaying = false;
        return undefined as T;
      }
      if (command === "resume") {
        isPlaying = true;
        return undefined as T;
      }
      if (command === "seek_to") return undefined as T;
      if (command === "stop_playback") return true as T;
      if (command === "get_track_lyrics") return embedded as T;
      if (command === "get_playback_sidecar_lyrics") {
        const id = args?.trackId;
        if (typeof id !== "number") throw new Error("Missing trackId");
        reads.push(id);
        const text = readFileSync(join(directory, `${id}.lrc`), "utf8");
        // Command boundary adapter for the real fixture. Rust IPC tests verify parsing.
        return (
          text === "[00:01]sidecar original"
            ? original
            : text === "[00:02]sidecar changed"
              ? changed
              : null
        ) as T;
      }
      throw new Error(`Unexpected command ${command}`);
    };
    const scope = effectScope();
    try {
      const session = createPlaybackSession({ invokeCommand, restoredQueueSnapshot: null });
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
      expect(preparations).toContain(2);
      expect(reads).toEqual([1]);
      expect(lyrics.state.value).toEqual({
        status: "ready",
        lyrics: validSidecar ? original : { kind: "instrumental" },
      });
      writeFileSync(path, "[00:02]sidecar changed");
      await session.togglePlayback(async () => true);
      await session.togglePlayback(async () => true);
      await session.seekTo(3000);
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
      const previousPlaybackId = session.state.currentPlaybackId.value!;
      expect(
        session.observePlaybackTransition({
          previousPlaybackId,
          playbackId: previousPlaybackId + 1,
          rowKey: "2",
          trackId: 2,
          title: "two",
          artist: null,
        }),
      ).toBe(true);
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

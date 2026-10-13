import { afterEach, expect, it } from "bun:test";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { createTrackRegistration } from "@/features/tracks/registration";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import type { TracksInvoker } from "@/features/tracks/api";
import type { TrackDetails, TrackRegistrationResult } from "@/features/tracks/types";
import type { createPlaylistAppend } from "@/features/playlist/tracks/append";
import { createPlaylistApi } from "@/features/playlist/api";
import { playbackFixture } from "../../support/playback/session";
import { evaluateSource, transpileScript } from "../../support/module/loader";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
function track(id: number, title = `file-${id}`): TrackDetails {
  return {
    id,
    title,
    path: `C:\\music\\${id}.flac`,
    artist: null,
    album: null,
    albumArtist: null,
    releaseDate: null,
    discNumber: null,
    trackNumber: null,
    discTotal: null,
    trackTotal: null,
    durationMs: null,
    codec: null,
    sampleRateHz: null,
    bitrateKbps: null,
    channels: null,
  };
}
function registered(id: number): TrackRegistrationResult {
  return { status: "registered", track: track(id), needsMetadata: true };
}
const appendModule = evaluateSource<{ createPlaylistAppend: typeof createPlaylistAppend }>(
  transpileScript(await Bun.file("src/features/playlist/tracks/append.ts").text()),
  { "@/features/playlist/events": { reportPlaylistChanged: () => {} } },
);
it("playlist append retains independent duplicate occurrences and order across batches", async () => {
  const rows: Array<{ itemId: number; trackId: number }> = [{ itemId: 1, trackId: 42 }];
  const invokeCommand: TracksInvoker = async <T>(command: string, args?: InvokeArgs) => {
    if (args instanceof ArrayBuffer || ArrayBuffer.isView(args) || Array.isArray(args))
      throw new Error("Unexpected binary arguments");
    if (command === "register_local_tracks") return [registered(9), registered(7)] as T;
    expect(command).toBe("append_playlist_tracks");
    expect(args?.playlistId).toBe(3);
    const ids = args?.trackIds;
    if (!Array.isArray(ids)) throw new Error("Missing track IDs");
    return ids.map((trackId: number, index: number) => {
      const playlistItemId = rows.length + 1;
      rows.push({ itemId: playlistItemId, trackId });
      return { index, trackId, status: "added", playlistItemId };
    }) as T;
  };
  const append = appendModule.createPlaylistAppend(createPlaylistApi(invokeCommand));
  const action = createTrackRegistration(invokeCommand);
  for (let batch = 0; batch < 2; batch++) {
    const outcome = await action(
      ["folder", "folder/child"],
      (tracks) =>
        append(
          3,
          tracks.map((track) => track.id),
        ),
      async () => {},
    );
    expect(outcome.appendError).toBeNull();
  }
  expect(rows).toEqual([
    { itemId: 1, trackId: 42 },
    { itemId: 2, trackId: 9 },
    { itemId: 3, trackId: 7 },
    { itemId: 4, trackId: 9 },
    { itemId: 5, trackId: 7 },
  ]);
});
it("playlist target failures do not undo registration or earlier append and subsequent successes remain", async () => {
  const added: number[] = [];
  const invokeCommand: TracksInvoker = async <T>(command: string, args?: InvokeArgs) => {
    if (args instanceof ArrayBuffer || ArrayBuffer.isView(args) || Array.isArray(args))
      throw new Error("Unexpected binary arguments");
    if (command === "register_local_tracks")
      return [
        registered(1),
        registered(2),
        registered(3),
        { status: "failed", path: "bad", error: "unreadable" },
      ] as T;
    expect(command).toBe("append_playlist_tracks");
    const ids = args?.trackIds;
    if (!Array.isArray(ids)) throw new Error("Missing track IDs");
    return ids.map((trackId: number, index: number) => {
      if (trackId === 2) return { index, trackId, status: "failed", error: "target unavailable" };
      added.push(trackId);
      return { index, trackId, status: "added", playlistItemId: added.length };
    }) as T;
  };
  const append = appendModule.createPlaylistAppend(createPlaylistApi(invokeCommand));
  const refreshed: number[][] = [];
  const outcome = await createTrackRegistration(invokeCommand)(
    ["folder"],
    (tracks) =>
      append(
        5,
        tracks.map((track) => track.id),
      ),
    async (ids) => {
      refreshed.push([...ids]);
      throw new Error("refresh unavailable");
    },
  );
  expect(added).toEqual([1, 3]);
  expect(outcome.results.map((result) => result.status)).toEqual([
    "registered",
    "registered",
    "registered",
    "failed",
  ]);
  expect(outcome.appendError).toBe("target unavailable");
  expect(outcome.appendResults?.results).toEqual([
    { index: 0, trackId: 1, status: "added", playlistItemId: 1 },
    { index: 1, trackId: 2, status: "failed", error: "target unavailable" },
    { index: 2, trackId: 3, status: "added", playlistItemId: 2 },
  ]);
  expect(refreshed).toEqual([[1, 2, 3]]);
  expect(outcome.refreshError).toBe("refresh unavailable");
});
it("queue appends to the end, preserves playing identity and refreshes every occurrence from one DB query", async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const { session, commands } = playbackFixture();
  await session.ready;
  await session.playTracks(
    [{ trackId: 7, rowKey: "current", title: "old", album: null, durationMs: null }],
    "current",
  );
  const playbackId = session.state.currentPlaybackId.value;
  commands.length = 0;
  const reads: unknown[] = [];
  const invokeCommand: TracksInvoker = async <T>(command: string, args?: InvokeArgs) => {
    if (args instanceof ArrayBuffer || ArrayBuffer.isView(args) || Array.isArray(args))
      throw new Error("Unexpected binary arguments");
    if (command === "register_local_tracks")
      return [
        registered(9),
        registered(7),
        { status: "failed", path: "bad", error: "unreadable" },
      ] as T;
    expect(command).toBe("get_tracks");
    reads.push(args?.trackIds);
    return [track(9, "New title"), track(7, "Confirmed title")] as T;
  };
  const synchronization = createTrackSynchronization(session, invokeCommand);
  const action = createTrackRegistration(invokeCommand);
  const append = async (tracks: readonly TrackDetails[]) => {
    expect(
      await session.addTracksToQueueEnd(
        tracks.map((track) => ({
          trackId: track.id,
          title: track.title,
          album: track.album,
          durationMs: track.durationMs,
        })),
      ),
    ).toBe(true);
  };
  await action(["folder"], append, synchronization.refresh);
  await action(["folder"], append, synchronization.refresh);
  const rows = session.state.displayedTracks.value;
  expect(rows.map((row) => row.trackId)).toEqual([7, 9, 7, 9, 7]);
  expect(new Set(rows.map((row) => row.rowKey)).size).toBe(5);
  expect(rows.filter((row) => row.trackId === 7).map((row) => row.title)).toEqual(
    Array(3).fill("Confirmed title"),
  );
  expect(session.state.currentPlaybackId.value).toBe(playbackId);
  expect(session.state.activeQueueRowKey.value).toBe("current");
  expect(session.state.playbackStatus.value.isPlaying).toBe(true);
  expect(commands.map((command) => command.action)).toEqual(["add", "metadata", "add", "metadata"]);
  expect(reads).toEqual([
    [9, 7],
    [9, 7],
  ]);
  session.dispose();
});
it("all registration failures never invoke append or refresh and refresh failure preserves successful registration", async () => {
  const failure: TrackRegistrationResult = { status: "failed", path: "bad", error: "unreadable" };
  let results: TrackRegistrationResult[] = [failure];
  const invokeCommand: TracksInvoker = async <T>() => results as T;
  let appends = 0;
  let refreshes = 0;
  const action = createTrackRegistration(invokeCommand);
  const outcome = await action(
    ["bad"],
    async () => {
      appends++;
    },
    async () => {
      refreshes++;
    },
  );
  expect(outcome.results).toEqual([failure]);
  expect([appends, refreshes]).toEqual([0, 0]);
  results = [registered(7)];
  const refreshed = await action(
    ["good"],
    async () => {
      appends++;
    },
    async () => {
      throw new Error("refresh unavailable");
    },
  );
  expect(refreshed.results).toEqual([registered(7)]);
  expect(refreshed.appendError).toBeNull();
  expect(refreshed.refreshError).toBe("refresh unavailable");
});

it("batch command rejection preserves registered tracks and refresh without reporting added items", async () => {
  const invokeCommand: TracksInvoker = async <T>(command: string) => {
    if (command === "register_local_tracks") return [registered(1), registered(2)] as T;
    expect(command).toBe("append_playlist_tracks");
    throw new Error("Failed to finish playlist update");
  };
  const append = appendModule.createPlaylistAppend(createPlaylistApi(invokeCommand));
  const refreshed: number[][] = [];
  const outcome = await createTrackRegistration(invokeCommand)(
    ["folder"],
    (tracks) =>
      append(
        3,
        tracks.map((track) => track.id),
      ),
    async (ids) => {
      refreshed.push([...ids]);
    },
  );
  expect(outcome.results).toEqual([registered(1), registered(2)]);
  expect(outcome.appendResults).toBeNull();
  expect(outcome.appendError).toBe("Failed to finish playlist update");
  expect(refreshed).toEqual([[1, 2]]);
});

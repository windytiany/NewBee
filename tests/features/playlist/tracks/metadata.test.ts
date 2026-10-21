import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type { TracksInvoker } from "@/features/tracks/api";
import type { TrackDetails } from "@/features/tracks/types";
import type { PlaylistTrackSummary } from "@/features/playlist/types";
import type { usePlaylist } from "@/features/playlist/usePlaylist";
import { reportTracksChanged, TRACKS_CHANGED_EVENT } from "@/features/tracks/events";
import { reportPlaylistChanged } from "@/features/playlist/events";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { createMetadataSave } from "@/features/metadata/save";
import { evaluateSource, transpileScript } from "../../../support/module/loader";
import { createHostNode, createHostRenderer } from "../../../support/host/renderer";

const source = transpileScript(await Bun.file("src/features/playlist/usePlaylist.ts").text());
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
function snapshot(id = 7, title = "Confirmed"): TrackDetails {
  return {
    id,
    title,
    path: `${id}.flac`,
    artist: "New artist",
    album: "New album",
    durationMs: 2000,
    albumArtist: null,
    releaseDate: null,
    discNumber: null,
    trackNumber: null,
    discTotal: null,
    trackTotal: null,
    codec: "FLAC",
    sampleRateHz: null,
    bitrateKbps: null,
    channels: null,
  };
}
function row(playlistItemId: number, trackId = 7): PlaylistTrackSummary {
  return { playlistItemId, trackId, title: "Old", artist: null, album: null, durationMs: null };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function harness(initialActive = true) {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const active = Vue.ref(initialActive);
  const calls: Array<[string, InvokeArgs | undefined]> = [];
  let rows = [row(11), row(12, 8), row(13)];
  let getTracks: (ids: number[]) => Promise<TrackDetails[]> = async (ids) =>
    ids.map((id) => snapshot(id));
  let reorder: () => Promise<void> = async () => {};
  let listTracks: () => Promise<PlaylistTrackSummary[]> = async () =>
    rows.map((entry) => ({ ...entry }));
  const invokeCommand: TracksInvoker = async <T>(command: string, args?: InvokeArgs) => {
    calls.push([command, args]);
    if (command === "list_playlists")
      return [{ id: 1, name: "List", trackCount: rows.length, coverTrackId: 7 }] as T;
    if (command === "list_playlist_tracks") return (await listTracks()) as T;
    if (command === "get_tracks") {
      if (
        !args ||
        args instanceof ArrayBuffer ||
        ArrayBuffer.isView(args) ||
        Array.isArray(args) ||
        !Array.isArray(args.trackIds)
      )
        throw new Error("Missing IDs");
      return (await getTracks(args.trackIds)) as T;
    }
    if (command === "reorder_playlist_items") return (await reorder()) as T;
    if (command === "reread_track_tags")
      return [
        { trackId: 7, databaseUpdated: true, error: null },
        { trackId: 8, databaseUpdated: false, error: "DB failed" },
      ] as T;
    throw new Error(`Unexpected command: ${command}`);
  };
  const session = { state: {}, updateTrackMetadata: async () => {} };
  const { usePlaylist: createPage } = evaluateSource<{
    usePlaylist: typeof usePlaylist;
  }>(source, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke: invokeCommand },
    "@/features/playback/session": { usePlaybackSession: () => session },
  });
  let page!: ReturnType<typeof import("@/features/playlist/usePlaylistState").usePlaylistState>;
  const app = createHostRenderer(createHostNode).createApp({
    setup() {
      page = Vue.toRaw(createPage(active)).page as unknown as typeof page;
      return () => null;
    },
  });
  app.mount(createHostNode("root"));
  apps.push(app);
  await Bun.sleep(0);
  if (initialActive) {
    page.selectPlaylist(page.playlists.value[0]!);
    await Bun.sleep(0);
  }
  calls.length = 0;
  return {
    active,
    page,
    calls,
    invokeCommand,
    session,
    setRows: (value: PlaylistTrackSummary[]) => {
      rows = value;
    },
    setGetTracks: (value: typeof getTracks) => {
      getTracks = value;
    },
    setListTracks: (value: typeof listTracks) => {
      listTracks = value;
    },
    setReorder: (value: typeof reorder) => {
      reorder = value;
    },
  };
}

it("patches duplicate rows in place, ignores unknown IDs and batches only the affected intersection when details are absent", async () => {
  const test = await harness();
  const rows = test.page.playlistTracks.value;
  const identities = [...rows];
  reportTracksChanged([7, 99], [snapshot()]);
  expect(
    rows.map((entry) => [entry.playlistItemId, entry.title, entry.album, entry.durationMs]),
  ).toEqual([
    [11, "Confirmed", "New album", 2000],
    [12, "Old", null, null],
    [13, "Confirmed", "New album", 2000],
  ]);
  expect(test.calls).toEqual([]);
  reportTracksChanged([99], [snapshot(99)]);
  expect(test.calls).toEqual([]);
  reportTracksChanged([7, 8, 99]);
  await Bun.sleep(0);
  expect(test.calls).toEqual([["get_tracks", { trackIds: [7, 8] }]]);
  expect(test.page.playlistTracks.value).toBe(rows);
  for (let index = 0; index < rows.length; index++) expect(rows[index]).toBe(identities[index]);
  expect(rows.map((entry) => entry.title)).toEqual(["Confirmed", "Confirmed", "Confirmed"]);
});

it("does not fetch per background batch, and activation loads the correct structural and metadata snapshot", async () => {
  const test = await harness();
  test.active.value = false;
  for (let batch = 0; batch < 313; batch++) reportTracksChanged([7, 8]);
  expect(test.calls).toEqual([]);
  test.setRows([row(13), { ...row(11), title: "Latest", durationMs: 9000 }]);
  reportPlaylistChanged(1);
  await Bun.sleep(0);
  expect(test.calls).toEqual([]);
  test.active.value = true;
  await Bun.sleep(0);
  expect(test.calls.map(([command]) => command)).toEqual([
    "list_playlists",
    "list_playlist_tracks",
  ]);
  expect(
    test.page.playlistTracks.value.map((entry) => [entry.playlistItemId, entry.title]),
  ).toEqual([
    [13, "Old"],
    [11, "Latest"],
  ]);
  expect(test.page.selectedPlaylistId.value).toBe(1);
});

it("unloaded background playlists stay lazy and structural changes still reload active playlists", async () => {
  const test = await harness(false);
  for (let batch = 0; batch < 313; batch++) reportTracksChanged([7], [snapshot()]);
  expect(test.calls).toEqual([]);
  test.active.value = true;
  await Bun.sleep(0);
  test.page.selectPlaylist(test.page.playlists.value[0]!);
  await Bun.sleep(0);
  test.calls.length = 0;
  test.setRows([row(13), row(11), row(20, 8)]);
  reportPlaylistChanged(1);
  await Bun.sleep(0);
  expect(test.calls.map(([command]) => command)).toEqual([
    "list_playlists",
    "list_playlist_tracks",
  ]);
  expect(test.page.playlistTracks.value.map((entry) => entry.playlistItemId)).toEqual([13, 11, 20]);
});

it("confirmation arriving during a full-list read wins over its stale result", async () => {
  const test = await harness();
  const reading = deferred<PlaylistTrackSummary[]>();
  test.setListTracks(() => reading.promise);
  await test.page.refreshPlaylists();
  reportTracksChanged([7], [snapshot()]);
  reading.resolve([row(11), row(13)]);
  await Bun.sleep(0);
  expect(test.page.playlistTracks.value.map((entry) => entry.title)).toEqual([
    "Confirmed",
    "Confirmed",
  ]);
  expect(test.calls.map(([command]) => command)).toEqual([
    "list_playlists",
    "list_playlist_tracks",
  ]);
});

it("a newer confirmed snapshot cannot be overwritten by an older intersection fetch", async () => {
  const test = await harness();
  const reading = deferred<TrackDetails[]>();
  test.setGetTracks(() => reading.promise);
  reportTracksChanged([7]);
  reportTracksChanged([7], [snapshot(7, "Newest")]);
  reading.resolve([snapshot(7, "Stale")]);
  await Bun.sleep(0);
  expect(test.page.playlistTracks.value.map((entry) => entry.title)).toEqual([
    "Newest",
    "Old",
    "Newest",
  ]);
  expect(test.calls).toEqual([["get_tracks", { trackIds: [7] }]]);
});

it("reread and manual save retain individual file/DB outcomes when refresh fails and publish exactly once per operation", async () => {
  const test = await harness();
  let published = 0;
  window.addEventListener(TRACKS_CHANGED_EVENT, () => {
    published++;
  });
  test.setGetTracks(async () => {
    throw new Error("Refresh failed");
  });
  const reread = await createTrackSynchronization(test.session, test.invokeCommand).reread([7, 8]);
  expect(reread).toEqual({
    results: [
      { trackId: 7, databaseUpdated: true, error: null },
      { trackId: 8, databaseUpdated: false, error: "DB failed" },
    ],
    refreshError: "Refresh failed",
  });
  const results = [
    { trackId: 7, path: "7.flac", fileWritten: true, databaseUpdated: true, error: null },
    { trackId: 8, path: "8.flac", fileWritten: true, databaseUpdated: false, error: "DB failed" },
  ];
  const synchronization = createTrackSynchronization(test.session, test.invokeCommand);
  const save = createMetadataSave({
    editFiles: async (_ids, execute) => execute(),
    synchronize: synchronization.refresh,
  });
  expect(
    await save.run({ targets: results, writeTrackIds: [7, 8], execute: async () => results }),
  ).toEqual(results);
  await Bun.sleep(0);
  expect(save.state.results).toEqual(results);
  expect(save.state.synchronizationError).toContain("Refresh failed");
  expect(test.page.trackMetadataError.value).toContain("Refresh failed");
  expect(test.page.playlistTracksError.value).toBe("");
  expect(published).toBe(2);
  expect(test.calls.filter(([command]) => command.startsWith("list_"))).toEqual([]);
  expect(test.page.playlistTracks.value.map((entry) => entry.title)).toEqual(["Old", "Old", "Old"]);
  test.setGetTracks(async (ids) => ids.map((id) => snapshot(id)));
  await save.retrySynchronization();
  expect(save.state.results).toEqual(results);
  expect(save.state.synchronizationError).toBe("");
  expect(test.page.trackMetadataError.value).toBe("");
  expect(test.page.playlistTracks.value.map((entry) => entry.title)).toEqual([
    "Confirmed",
    "Old",
    "Confirmed",
  ]);
  expect(published).toBe(3);
});

it("drains later missing-detail batches after an outstanding intersection fetch", async () => {
  const test = await harness();
  const reading = deferred<TrackDetails[]>();
  test.setGetTracks(async (ids) => (ids[0] === 7 ? reading.promise : [snapshot(8)]));
  reportTracksChanged([7]);
  reportTracksChanged([8, 99]);
  expect(test.calls).toEqual([["get_tracks", { trackIds: [7] }]]);
  reading.resolve([snapshot(7)]);
  await Bun.sleep(0);
  expect(test.calls).toEqual([
    ["get_tracks", { trackIds: [7] }],
    ["get_tracks", { trackIds: [8] }],
  ]);
  expect(test.page.playlistTracks.value.map((entry) => entry.title)).toEqual([
    "Confirmed",
    "Confirmed",
    "Confirmed",
  ]);
});

for (const failed of [false, true]) {
  it(`metadata survives pending reorder ${failed ? "rollback" : "completion"} with duplicate row identities intact`, async () => {
    const test = await harness();
    const reordering = deferred<void>();
    test.setReorder(async () => {
      await reordering.promise;
      if (failed) throw new Error("Reorder failed");
    });
    const originalRows = [...test.page.playlistTracks.value];
    const saving = test.page.reorderPlaylistItems([13, 11, 12]);
    expect(test.page.isPlaylistActionPending.value).toBe(true);
    reportTracksChanged([7], [snapshot()]);
    expect(
      test.page.playlistTracks.value.map((entry) => [entry.playlistItemId, entry.title]),
    ).toEqual([
      [13, "Confirmed"],
      [11, "Confirmed"],
      [12, "Old"],
    ]);
    reordering.resolve();
    await saving;
    expect(test.page.playlistTracks.value.map((entry) => entry.playlistItemId)).toEqual(
      failed ? [11, 12, 13] : [13, 11, 12],
    );
    for (const entry of test.page.playlistTracks.value) {
      const original = originalRows.find((row) => row.playlistItemId === entry.playlistItemId);
      if (!original) throw new Error("Unexpected playlist item");
      expect(entry).toBe(original);
      expect(entry.title).toBe(entry.trackId === 7 ? "Confirmed" : "Old");
    }
    expect(test.page.isPlaylistActionPending.value).toBe(false);
    expect(test.calls.map(([command]) => command)).toEqual(["reorder_playlist_items"]);
  });
}

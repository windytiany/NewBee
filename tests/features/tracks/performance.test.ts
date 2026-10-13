import { expect, it } from "bun:test";
import * as Vue from "vue";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { createPlaylistApi } from "@/features/playlist/api";
import { createPlaylistAppend } from "@/features/playlist/tracks/append";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { createTrackBridge } from "@/features/tracks/bridge";
import type { TracksInvoker } from "@/features/tracks/api";
import type { TrackDetails, TrackReadResult } from "@/features/tracks/types";
import type { PlaylistTrackSummary } from "@/features/playlist/types";
import type { usePlaylistPage } from "@/features/playlist/composables/usePage";
import { evaluateSource, transpileScript } from "../../support/module/loader";
import { playbackFixture } from "../../support/playback/session";
import { createHostNode, createHostRenderer } from "../../support/host/renderer";
import { createItemSelection } from "@/shared/interaction/item/useSelection";

it("measures 5000-entry queue and mounted playlist metadata adapters without native IPC or DOM", async () => {
  const count = 5000;
  const snapshots: TrackDetails[] = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    path: `C:\\music\\${index}.flac`,
    title: `Confirmed ${index + 1}`,
    artist: "Artist",
    album: "Album",
    albumArtist: null,
    releaseDate: null,
    discNumber: null,
    trackNumber: null,
    discTotal: null,
    trackTotal: null,
    durationMs: 1000,
    codec: "FLAC",
    sampleRateHz: null,
    bitrateKbps: null,
    channels: null,
  }));
  const playlistTracks: PlaylistTrackSummary[] = snapshots.map((track) => ({
    playlistItemId: track.id,
    trackId: track.id,
    title: null,
    artist: null,
    album: null,
    durationMs: null,
  }));
  playlistTracks[count - 1] = { ...playlistTracks[0]!, playlistItemId: count };
  const calls = new Map<string, number>();
  let returnedPlaylistRows = 0;
  let returnedTrackRows = 0;
  const invokeCommand: TracksInvoker = async <T>(command: string, args?: InvokeArgs) => {
    if (args instanceof ArrayBuffer || ArrayBuffer.isView(args) || Array.isArray(args))
      throw new Error("Unexpected binary arguments");
    calls.set(command, (calls.get(command) ?? 0) + 1);
    if (command === "get_tracks") {
      const ids = new Set(Array.isArray(args?.trackIds) ? args.trackIds : []);
      const result = snapshots.filter((track) => ids.has(track.id));
      returnedTrackRows += result.length;
      return result as T;
    }
    if (command === "list_playlists")
      return [{ id: 1, name: "B", trackCount: count, coverTrackId: 1 }] as T;
    if (command === "list_playlist_tracks") {
      returnedPlaylistRows += count;
      return playlistTracks.map((track) => ({ ...track })) as T;
    }
    expect(command).toBe("append_playlist_tracks");
    const ids = args?.trackIds;
    if (!Array.isArray(ids)) throw new Error("Missing track IDs");
    return ids.map((trackId: number, index: number) => ({
      index,
      trackId,
      status: "added",
      playlistItemId: index + count + 1,
    })) as T;
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const { session, commands } = playbackFixture();
  const source = await Bun.file(
    new URL("../../../src/features/playlist/composables/usePage.ts", import.meta.url),
  ).text();
  const { usePlaylistPage: createPage } = evaluateSource<{
    usePlaylistPage: typeof usePlaylistPage;
  }>(transpileScript(source), {
    vue: Vue,
    "@tauri-apps/api/core": { invoke: invokeCommand },
    "@/features/playback/session": { usePlaybackSession: () => session },
  });
  let page!: ReturnType<typeof usePlaylistPage>;
  const app = createHostRenderer(createHostNode).createApp({
    setup() {
      page = createPage(Vue.ref(true));
      return () => null;
    },
  });
  try {
    app.mount(createHostNode("root"));
    await Bun.sleep(0);
    page.selectPlaylist(page.playlists.value[0]!);
    await Bun.sleep(0);
    expect(page.playlistTracks.value).toHaveLength(count);
    const start = performance.now();
    await session.addTracksToQueueEnd(
      snapshots.map((track) => ({ trackId: track.id, title: null, album: null, durationMs: null })),
    );
    const queueAddMs = performance.now() - start;
    expect(commands.filter((command) => command.action === "add")).toHaveLength(1);
    const appendStart = performance.now();
    const appended = await createPlaylistAppend(createPlaylistApi(invokeCommand))(
      1,
      snapshots.map((track) => track.id),
    );
    await Bun.sleep(0);
    const playlistAppendMs = performance.now() - appendStart;
    const playlistAppendCommands = calls.get("append_playlist_tracks") ?? 0;
    expect(playlistAppendCommands).toBe(1);
    expect(appended.error).toBeNull();
    expect(appended.results).toHaveLength(count);
    expect(appended.results.map((result) => result.trackId)).toEqual(
      snapshots.map((track) => track.id),
    );
    expect(
      new Set(
        appended.results.flatMap((result) =>
          result.status === "added" ? [result.playlistItemId] : [],
        ),
      ).size,
    ).toBe(count);
    const loadedRows = page.playlistTracks.value;
    const identities = loadedRows.map((row) => [row.playlistItemId, row.trackId]);
    const selection = createItemSelection();
    const keys = loadedRows.map((row) => String(row.playlistItemId));
    selection.selectItem("playlist:1", "1", keys, { ctrlKey: false, shiftKey: false });
    selection.selectItem("playlist:1", String(count), keys, { ctrlKey: true, shiftKey: false });
    const stopSelection = Vue.watch(
      () => page.playlistTracks.value.map((row) => String(row.playlistItemId)),
      (keys) => selection.syncVisibleItems("playlist:1", keys),
      { flush: "sync" },
    );
    calls.clear();
    returnedPlaylistRows = 0;
    returnedTrackRows = 0;
    commands.length = 0;
    let maxEventLoopDelayMs = 0;
    let deadline = performance.now() + 5;
    const timer = setInterval(() => {
      const now = performance.now();
      maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, now - deadline);
      deadline = now + 5;
    }, 5);
    const synchronization = createTrackSynchronization(session, invokeCommand);
    const errors: unknown[] = [];
    let refreshMs = 0;
    let receive: (results: readonly TrackReadResult[]) => void = () => {
      throw new Error("Bridge not subscribed");
    };
    const bridge = createTrackBridge(
      async (ids) => {
        const start = performance.now();
        try {
          await synchronization.refresh(ids);
        } finally {
          refreshMs += performance.now() - start;
        }
      },
      async (listener) => {
        receive = listener;
        return () => {};
      },
      (error) => errors.push(error),
    );
    await bridge.start();
    const metadataStart = performance.now();
    try {
      for (let offset = 0; offset < count; offset += 16) {
        const batch = snapshots.slice(offset, offset + 16);
        for (const snapshot of batch) {
          for (const row of playlistTracks.filter((row) => row.trackId === snapshot.id)) {
            Object.assign(row, {
              title: snapshot.title,
              artist: snapshot.artist,
              album: snapshot.album,
              durationMs: snapshot.durationMs,
            });
          }
        }
        receive(batch.map((track) => ({ trackId: track.id, databaseUpdated: true, error: null })));
        await Bun.sleep(50);
      }
      await Bun.sleep(50);
    } finally {
      bridge.dispose();
      clearInterval(timer);
    }
    expect(session.state.displayedTracks.value).toHaveLength(count);
    expect(
      session.state.displayedTracks.value.every((track) => track.title?.startsWith("Confirmed ")),
    ).toBe(true);
    expect(page.playlistTracks.value.every((track) => track.title?.startsWith("Confirmed "))).toBe(
      true,
    );
    const batches = Math.ceil(count / 16);
    expect(errors).toEqual([]);
    expect(calls.get("get_tracks") ?? 0).toBeGreaterThan(0);
    expect(calls.get("get_tracks") ?? 0).toBeLessThanOrEqual(batches);
    expect(commands.filter((command) => command.action === "metadata")).toHaveLength(
      calls.get("get_tracks") ?? 0,
    );
    expect(calls.get("list_playlist_tracks") ?? 0).toBe(0);
    expect(calls.get("list_playlists") ?? 0).toBe(0);
    expect(returnedPlaylistRows).toBe(0);
    expect(returnedTrackRows).toBe(count);
    expect(page.playlistTracks.value).toBe(loadedRows);
    expect(page.playlistTracks.value.map((row) => [row.playlistItemId, row.trackId])).toEqual(
      identities,
    );
    for (const row of page.playlistTracks.value) {
      const snapshot = snapshots[row.trackId - 1]!;
      expect([row.title, row.artist, row.album, row.durationMs]).toEqual([
        snapshot.title,
        snapshot.artist,
        snapshot.album,
        snapshot.durationMs,
      ]);
    }
    expect(selection.selection.value?.selectedItemKeys).toEqual(["1", String(count)]);
    expect(page.selectedPlaylistId.value).toBe(1);
    expect(selection.selection.value?.anchorItemKey).toBe("1");
    stopSelection();
    console.log(
      JSON.stringify({
        benchmark: "B adapters",
        count,
        queueAddMs,
        playlistAppendMs,
        playlistAppendCommands,
        confirmationBatches: batches,
        confirmationIntervalMs: 50,
        metadataMs: performance.now() - metadataStart,
        refreshMs,
        calls: Object.fromEntries(calls),
        returnedPlaylistRows,
        returnedTrackRows,
        maxEventLoopDelayMs,
      }),
    );
  } finally {
    app.unmount();
    session.dispose();
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
}, 60000);

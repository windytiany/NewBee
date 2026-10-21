import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { transpileScript, evaluateSource } from "../../support/module/loader";

import type * as LibraryChanges from "@/features/library/events";
import type * as LibraryScan from "@/features/library/synchronization/useScan";
import type * as LibraryPage from "@/features/library/browser/useBrowser";
import type * as PlaylistPage from "@/features/playlist/usePlaylist";
import { notifications, type NotificationInput } from "@/shared/notifications/center";
import { createTaskCenter } from "@/shared/tasks/state";

const outputs = new Map<string, string>();
for (const path of [
  "features/library/events",
  "features/library/synchronization/useScan",
  "features/library/browser/useBrowser",
  "features/playlist/usePlaylistState",
  "features/playlist/usePlaylist",
]) {
  const source = await Bun.file(new URL(`../../../src/${path}.ts`, import.meta.url)).text();
  outputs.set(path, transpileScript(source));
}
const readTracksEvents = await Bun.file("src/features/tracks/events.ts").text();
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function createHarness(mode: "Library" | "Playlist" | "Playing" = "Library") {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const calls: string[] = [];
  const effects: Array<readonly number[] | "all" | "albums" | "refresh"> = [];
  const notices: NotificationInput[] = [];
  const tasks = createTaskCenter();
  const artist = { artist: "Artist", albumCount: 1 };
  const album = { albumArtist: "Artist", album: "Album", year: 2024 };
  const track = { id: 41, title: "Song", artist: "Artist", album: "Album", durationMs: 100 };
  const registeredTracks = [track, { ...track, id: 42 }];
  let tracks = [...registeredTracks];
  const playlists = Vue.ref([{ id: 7, name: "List", trackCount: 2, coverTrackId: 41 }]);
  const selectedPlaylistId = Vue.ref<number | null>(7);
  const selectedGroup = Vue.ref<typeof artist | null>(artist);
  const selectedAlbum = Vue.ref({ albumArtist: "Artist", album: "Album" });
  let scanResult = { added: 1, updated: 0, skipped: 0, failed: 0 };
  let scanError: Error | null = null;
  let deleteFailureId: number | null = null;
  let queueFailure = false;
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@tauri-apps/api/core": {
      isTauri: () => true,
      invoke: async (command: string, args?: { trackId?: number }) => {
        calls.push(command);
        if (command === "synchronize_library") {
          if (scanError) throw scanError;
          // The native result event is forwarded by the shared synchronization listener.
          changes.reportLibraryImport(scanResult);
          return scanResult;
        }
        if (command === "list_artists") return [artist];
        if (command === "list_albums") return [album];
        if (command === "list_album_tracks") return tracks;
        if (command === "get_tracks") return registeredTracks;
        if (command === "remove_track_from_library") {
          if (args?.trackId === deleteFailureId) throw new Error("database busy");
          tracks = tracks.filter(({ id }) => id !== args?.trackId);
          return queueFailure
            ? { status: "stop-failed", message: "device busy" }
            : { status: "not-found" };
        }
        if (command === "list_playlists") {
          return [
            {
              id: 7,
              name: "List",
              trackCount: registeredTracks.length,
              coverTrackId: registeredTracks[0]?.id ?? null,
            },
          ];
        }
        if (command === "list_playlist_tracks") {
          return registeredTracks.map(({ id, ...summary }) => ({
            ...summary,
            trackId: id,
            playlistItemId: id,
          }));
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    },
    "@/features/artwork/track/useArtwork": {
      invalidateTrackArtworkCache: (ids?: readonly number[]) => effects.push(ids ?? "all"),
    },
    "@/features/artwork/album/useArtwork": {
      invalidateAlbumArtworkCache: () => effects.push("albums"),
    },
    "@tauri-apps/api/event": { listen: async () => () => {} },
    "@/features/library/synchronization/state": {
      synchronizationSnapshot: Vue.ref({ progress: null, statuses: [], missing: [] }),
      refreshSynchronization: async () => {},
    },
    "@/shared/tasks/state": { tasks },
    "@/shared/notifications/center": {
      notifications,
      notify: (notice: NotificationInput) => notices.push(notice),
    },
    "@/features/settings/events": { SETTINGS_CHANGED_EVENT: "settings-changed" },
    "@/features/library/browser/useSelection": {
      useLibrarySelection: () => ({
        grouping: Vue.ref("albumArtist"),
        setGrouping: () => {},
        selectedGroup,
        selectedAlbum,
        setAvailableGroups: () => {},
        setAvailableAlbums: () => {},
      }),
    },
    "@/features/playlist/list/useSelection": {
      usePlaylistSelection: () => ({
        availablePlaylists: playlists,
        selectedPlaylistId,
        selectedPlaylist: Vue.computed(
          () => playlists.value.find(({ id }) => id === selectedPlaylistId.value) ?? null,
        ),
        setAvailablePlaylists: (value: typeof playlists.value) => {
          playlists.value = value;
        },
      }),
    },
    "@/features/playback/session": {
      usePlaybackSession: () => ({
        state: { currentTrack: Vue.ref(null), activeQueueRowKey: Vue.ref(null) },
      }),
    },
  };
  function load<T>(path: string): T {
    const exports = evaluateSource<T>(outputs.get(path)!, modules);
    modules[`@/${path}`] = exports;
    return exports;
  }
  const changes = load<typeof LibraryChanges>("features/library/events");
  const scan = load<typeof LibraryScan>(
    "features/library/synchronization/useScan",
  ).useLibrarySynchronization();
  const { useLibraryBrowser } = load<typeof LibraryPage>("features/library/browser/useBrowser");
  load("features/playlist/usePlaylistState");
  const { usePlaylist } = load<typeof PlaylistPage>("features/playlist/usePlaylist");
  globalThis.window.addEventListener(changes.LIBRARY_CHANGED_EVENT, () => effects.push("refresh"));
  const activePage = Vue.ref(mode);
  let library!: ReturnType<typeof useLibraryBrowser>;
  let playlist!: ReturnType<typeof import("@/features/playlist/usePlaylistState").usePlaylistState>;
  const renderer = Vue.createRenderer<object>({
    patchProp: () => {},
    insert: () => {},
    remove: () => {},
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
  });
  const app = renderer.createApp({
    setup() {
      library = useLibraryBrowser(Vue.computed(() => activePage.value === "Library"));
      playlist = Vue.toRaw(usePlaylist(Vue.computed(() => activePage.value === "Playlist")))
        .page as unknown as typeof playlist;
      return () => null;
    },
  });
  app.mount({});
  apps.push(app);
  return {
    changes,
    scan,
    library,
    playlist,
    calls,
    effects,
    notices,
    tasks,
    activePage,
    updateSnapshot: (title: string) => {
      for (const entry of registeredTracks) entry.title = title;
      const { reportTracksChanged } = evaluateSource<typeof import("@/features/tracks/events")>(
        transpileScript(readTracksEvents),
        modules,
      );
      reportTracksChanged(
        [41, 42],
        registeredTracks.map((track) => ({
          ...track,
          path: `${track.id}.flac`,
          albumArtist: null,
          releaseDate: null,
          discNumber: null,
          trackNumber: null,
          discTotal: null,
          trackTotal: null,
          codec: null,
          sampleRateHz: null,
          bitrateKbps: null,
          channels: null,
        })),
      );
    },
    setScanResult: (result: typeof scanResult) => {
      scanResult = result;
    },
    failScan: () => {
      scanError = new Error("scan failed");
    },
    failDeletion: (id: number) => {
      deleteFailureId = id;
    },
    failQueue: () => {
      queueFailure = true;
    },
  };
}

async function settle() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

describe("媒体库变更", () => {
  it("通用曲目变化局部更新后台已加载歌单，保留条目身份", async () => {
    const harness = createHarness("Playlist");
    await settle();
    const ids = harness.playlist.playlistTracks.value.map((track) => track.playlistItemId);
    expect(ids).toEqual([41, 42]);
    harness.activePage.value = "Playing";
    harness.calls.length = 0;
    harness.updateSnapshot("Updated snapshot");
    await settle();
    expect(harness.playlist.playlistTracks.value.map((track) => track.title)).toEqual([
      "Updated snapshot",
      "Updated snapshot",
    ]);
    expect(harness.playlist.playlistTracks.value.map((track) => track.playlistItemId)).toEqual(ids);
    expect(harness.calls.filter((command) => command === "list_playlist_tracks")).toHaveLength(0);
    expect(harness.effects).toEqual([[41, 42], "albums"]);
  });
  for (const mode of ["Library", "Playlist", "Playing"] as const) {
    it(`${mode} 活跃时扫描写入失效封面并刷新活跃媒体库，不重读歌单目录`, async () => {
      const harness = createHarness(mode);
      await settle();
      harness.calls.length = 0;
      harness.setScanResult({ added: 0, updated: 1, skipped: 0, failed: 1 });
      await harness.scan.synchronizeLibrary();
      await settle();
      expect(harness.effects).toEqual(["all", "albums", "refresh"]);
      expect(harness.calls.filter((command) => command === "list_playlists")).toHaveLength(0);
      expect(harness.calls.filter((command) => command === "list_playlist_tracks")).toHaveLength(0);
      expect(harness.calls.includes("list_artists")).toBe(mode === "Library");
      expect(harness.notices).toEqual([]);
      expect(harness.tasks.items.value[0]?.result?.type).toBe("warning");
    });
  }

  it("无写入仍通知完成，失败不传播变更", async () => {
    const harness = createHarness("Playing");
    harness.setScanResult({ added: 0, updated: 0, skipped: 2, failed: 1 });
    await harness.scan.synchronizeLibrary();
    expect(harness.effects).toEqual([]);
    expect(harness.calls).toEqual(["synchronize_library"]);
    expect(harness.notices).toEqual([]);
    expect(harness.tasks.items.value[0]?.result?.type).toBe("warning");
    harness.failScan();
    await harness.scan.synchronizeLibrary();
    expect(harness.effects).toEqual([]);
    expect(harness.notices).toEqual([]);
    expect(harness.tasks.items.value[0]?.result?.type).toBe("error");
  });

  it("专辑部分删除按批次传播实际删除曲目，队列失败不阻断后台刷新", async () => {
    const harness = createHarness();
    await settle();
    harness.calls.length = 0;
    harness.failDeletion(42);
    harness.failQueue();
    const result = await harness.library.removeAlbumFromLibrary({
      albumArtist: "Artist",
      album: "Album",
    });
    await settle();
    expect(result.deletedCount).toBe(1);
    expect(result.completed).toBe(false);
    expect(harness.effects).toEqual(["albums", "refresh"]);
    expect(harness.calls.filter((command) => command === "list_artists")).toHaveLength(1);
    expect(harness.calls.filter((command) => command === "list_playlists")).toHaveLength(0);
    expect(harness.playlist.playlists.value[0]?.trackCount).toBe(2);
    harness.activePage.value = "Playlist";
    await settle();
    expect(harness.playlist.playlistTracks.value.map(({ trackId }) => trackId)).toEqual([41, 42]);
  });

  it("单曲删除失败不传播，数据库成功但停止播放失败仍传播", async () => {
    const harness = createHarness();
    await settle();
    harness.failDeletion(42);
    expect((await harness.library.removeTrackFromLibrary(42)).status).toBe("not-deleted");
    expect(harness.effects).toEqual([]);
    harness.failQueue();
    expect((await harness.library.removeTrackFromLibrary(41)).status).toBe(
      "deleted-queue-sync-failed",
    );
    await settle();
    expect(harness.effects).toEqual(["albums", "refresh"]);
    expect(harness.playlist.playlists.value[0]?.trackCount).toBe(2);
  });

  it("空删除批次不失效封面或查询", () => {
    const harness = createHarness("Playing");
    harness.changes.reportLibraryRemoval([]);
    expect(harness.effects).toEqual([]);
    expect(harness.calls).toEqual([]);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { transpileScript, evaluateSource } from "../../support/moduleLoader";

import type * as LibraryChanges from "@/features/library/events";
import type * as LibraryScan from "@/features/library/import/useScan";
import type * as LibraryPage from "@/features/library/composables/useBrowser";
import type * as PlaylistPage from "@/features/playlist/composables/usePage";
import type { NotificationInput } from "@/shared/notifications/center";

const outputs = new Map<string, string>();
for (const path of [
  "features/library/events",
  "features/library/import/useScan",
  "features/library/composables/useBrowser",
  "features/playlist/composables/useState",
  "features/playlist/composables/usePage",
]) {
  const source = await Bun.file(new URL(`../../../src/${path}.ts`, import.meta.url)).text();
  outputs.set(path, transpileScript(source));
}
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
  const artist = { albumArtist: "Artist", albumCount: 1 };
  const album = { album: "Album", year: 2024 };
  const track = { id: 41, title: "Song", artist: "Artist", album: "Album", durationMs: 100 };
  let tracks = [track, { ...track, id: 42 }];
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
      invoke: async (command: string, args?: { trackId?: number }) => {
        calls.push(command);
        if (command === "scan_music_library") {
          if (scanError) throw scanError;
          return scanResult;
        }
        if (command === "list_album_artists") return [artist];
        if (command === "list_albums") return [album];
        if (command === "list_album_tracks") return tracks;
        if (command === "remove_track_from_library") {
          if (args?.trackId === deleteFailureId) throw new Error("database busy");
          tracks = tracks.filter(({ id }) => id !== args?.trackId);
          return undefined;
        }
        if (command === "list_playlists") {
          return [
            { id: 7, name: "List", trackCount: tracks.length, coverTrackId: tracks[0]?.id ?? null },
          ];
        }
        if (command === "list_playlist_tracks") {
          return tracks.map(({ id, ...summary }) => ({
            ...summary,
            trackId: id,
            playlistItemId: id,
          }));
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    },
    "@/features/artwork/useTrackArtwork": {
      invalidateTrackArtworkCache: (ids?: readonly number[]) => effects.push(ids ?? "all"),
    },
    "@/features/artwork/useAlbumArtwork": {
      invalidateAlbumArtworkCache: () => effects.push("albums"),
    },
    "@/shared/notifications/center": {
      notify: (notice: NotificationInput) => notices.push(notice),
    },
    "@/features/settings/events": { SETTINGS_CHANGED_EVENT: "settings-changed" },
    "@/features/library/composables/useSelection": {
      useLibrarySelection: () => ({
        selectedGroup,
        selectedAlbum,
        setAvailableGroups: () => {},
        setAvailableAlbums: () => {},
      }),
    },
    "@/features/playlist/composables/useSelection": {
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
        removeTrackFromQueue: async () =>
          queueFailure
            ? { status: "stop-failed", message: "device busy" }
            : { status: "not-found" },
      }),
    },
  };
  function load<T>(path: string): T {
    const exports = evaluateSource<T>(outputs.get(path)!, modules);
    modules[`@/${path}`] = exports;
    return exports;
  }
  const changes = load<typeof LibraryChanges>("features/library/events");
  const scan = load<typeof LibraryScan>("features/library/import/useScan").useLibraryScan();
  const { useLibraryBrowser } = load<typeof LibraryPage>("features/library/composables/useBrowser");
  load("features/playlist/composables/useState");
  const { usePlaylistPage } = load<typeof PlaylistPage>("features/playlist/composables/usePage");
  globalThis.window.addEventListener(changes.LIBRARY_CHANGED_EVENT, () => effects.push("refresh"));
  const activePage = Vue.ref(mode);
  let library!: ReturnType<typeof useLibraryBrowser>;
  let playlist!: ReturnType<typeof usePlaylistPage>;
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
      playlist = usePlaylistPage(Vue.computed(() => activePage.value === "Playlist"));
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
    activePage,
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
  for (const mode of ["Library", "Playlist", "Playing"] as const) {
    it(`${mode} 活跃时扫描写入先失效封面，再刷新歌单和活跃媒体库`, async () => {
      const harness = createHarness(mode);
      await settle();
      harness.calls.length = 0;
      harness.setScanResult({ added: 0, updated: 1, skipped: 0, failed: 1 });
      await harness.scan.scanMusicLibrary();
      await settle();
      expect(harness.effects).toEqual(["all", "albums", "refresh"]);
      expect(harness.calls.filter((command) => command === "list_playlists")).toHaveLength(1);
      expect(harness.calls.filter((command) => command === "list_playlist_tracks")).toHaveLength(1);
      expect(harness.calls.includes("list_album_artists")).toBe(mode === "Library");
      expect(harness.notices[0]?.type).toBe("warning");
    });
  }

  it("无写入仍通知完成，失败不传播变更", async () => {
    const harness = createHarness("Playing");
    harness.setScanResult({ added: 0, updated: 0, skipped: 2, failed: 1 });
    await harness.scan.scanMusicLibrary();
    expect(harness.effects).toEqual([]);
    expect(harness.calls).toEqual(["scan_music_library"]);
    expect(harness.notices[0]?.type).toBe("warning");
    harness.failScan();
    await harness.scan.scanMusicLibrary();
    expect(harness.effects).toEqual([]);
    expect(harness.notices[1]?.type).toBe("error");
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
    expect(harness.effects).toEqual([[41], "albums", "refresh"]);
    expect(harness.calls.filter((command) => command === "list_album_artists")).toHaveLength(1);
    expect(harness.calls.filter((command) => command === "list_playlists")).toHaveLength(1);
    expect(harness.playlist.playlists.value[0]?.trackCount).toBe(1);
    expect(harness.playlist.playlistTracks.value.map(({ trackId }) => trackId)).toEqual([42]);
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
    expect(harness.effects).toEqual([[41], "albums", "refresh"]);
    expect(harness.playlist.playlists.value[0]?.trackCount).toBe(1);
  });

  it("空删除批次不失效封面或查询", () => {
    const harness = createHarness("Playing");
    harness.changes.reportLibraryRemoval([]);
    expect(harness.effects).toEqual([]);
    expect(harness.calls).toEqual([]);
  });
});

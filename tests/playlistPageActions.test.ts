// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { computed, createRenderer, nextTick, ref } from "vue";
import type { usePlaylistPage } from "@/playlist/usePage";
import type { Playlist, PlaylistTrackData } from "@/types/playlist";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const firstPlaylist: Playlist = { id: 1, name: "First", trackCount: 3, coverTrackId: 501 };
const secondPlaylist: Playlist = { id: 2, name: "Second", trackCount: 1, coverTrackId: 601 };
const firstPlaylistTracks: PlaylistTrackData[] = [
  {
    playlistItemId: 201,
    trackId: 501,
    title: "First copy",
    artist: "Artist",
    album: "Album",
    durationMs: 100,
  },
  {
    playlistItemId: 202,
    trackId: 502,
    title: "Middle",
    artist: "Artist",
    album: "Album",
    durationMs: 110,
  },
  {
    playlistItemId: 203,
    trackId: 501,
    title: "Second copy",
    artist: "Artist",
    album: "Album",
    durationMs: 100,
  },
];
const secondPlaylistTracks: PlaylistTrackData[] = [
  {
    playlistItemId: 301,
    trackId: 601,
    title: "Other playlist",
    artist: "Elsewhere",
    album: "Elsewhere",
    durationMs: 130,
  },
];
const availablePlaylists = ref<Playlist[]>([]);
const selectedPlaylistId = ref<number | null>(null);
const selectedPlaylist = computed(
  () => availablePlaylists.value.find(({ id }) => id === selectedPlaylistId.value) ?? null,
);
let hasLoadedPlaylists = false;
let initialPlaylistId: number | null = 1;
let invokeHandler: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
let invokeCalls: Array<{ command: string; args?: Record<string, unknown> }>;
let addToNextBatches: number[][];
let addToQueueEndBatches: number[][];
const mountedApps: Array<{ unmount: () => void }> = [];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

mock.module("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => {
    invokeCalls.push({ command, args });
    return invokeHandler(command, args);
  },
}));

mock.module("@/playlist/selection", () => ({
  usePersistentPlaylistSelection: () => ({
    availablePlaylists,
    selectedPlaylistId,
    selectedPlaylist,
    setAvailablePlaylists(playlists: Playlist[]) {
      availablePlaylists.value = playlists;
      if (!hasLoadedPlaylists) {
        hasLoadedPlaylists = true;
        selectedPlaylistId.value = playlists.some(({ id }) => id === initialPlaylistId)
          ? initialPlaylistId
          : null;
      } else if (!playlists.some(({ id }) => id === selectedPlaylistId.value)) {
        selectedPlaylistId.value = null;
      }
    },
    selectPlaylist(playlist: Playlist) {
      if (availablePlaylists.value.some(({ id }) => id === playlist.id)) {
        selectedPlaylistId.value = playlist.id;
      }
    },
  }),
}));

mock.module("@/playback/session", () => ({
  usePlaybackSession: () => ({
    playTracks: async () => true,
    addTracksToNext: async (tracks: readonly { trackId: number }[]) => {
      addToNextBatches.push(tracks.map(({ trackId }) => trackId));
      return true;
    },
    addTracksToQueueEnd: async (tracks: readonly { trackId: number }[]) => {
      addToQueueEndBatches.push(tracks.map(({ trackId }) => trackId));
      return true;
    },
  }),
}));

mock.module("@/library/scan", () => ({ LIBRARY_SCAN_COMPLETED_EVENT: "library-scan-completed" }));

const { usePlaylistPage: createPlaylistPage } = await import("@/playlist/usePage");

function mountPlaylistPage(active = ref(true)) {
  let page!: ReturnType<typeof usePlaylistPage>;
  const renderer = createRenderer<object>({
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
      page = createPlaylistPage(active);
      return () => null;
    },
  });
  app.mount({});
  mountedApps.push(app);
  return page;
}

function getNumberArgument(args: Record<string, unknown> | undefined, key: string) {
  const value = args?.[key];
  if (typeof value !== "number") throw new Error(`Expected numeric ${key} argument.`);
  return value;
}

async function settleRequests() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  await nextTick();
  await Promise.resolve();
}

function setDefaultInvokeHandler() {
  invokeHandler = async (command, args) => {
    if (command === "list_playlists") return [firstPlaylist, secondPlaylist];
    if (command === "list_playlist_tracks") {
      return getNumberArgument(args, "playlistId") === firstPlaylist.id
        ? firstPlaylistTracks
        : secondPlaylistTracks;
    }
    return undefined;
  };
}

async function mountLoadedPlaylistPage() {
  const page = mountPlaylistPage();
  await settleRequests();
  expect(page.selectedPlaylistId.value).toBe(firstPlaylist.id);
  expect(page.playlistTracks.value).toEqual(firstPlaylistTracks);
  return page;
}

beforeEach(() => {
  availablePlaylists.value = [];
  selectedPlaylistId.value = null;
  hasLoadedPlaylists = false;
  initialPlaylistId = firstPlaylist.id;
  invokeCalls = [];
  addToNextBatches = [];
  addToQueueEndBatches = [];
  setDefaultInvokeHandler();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {} },
  });
});

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("歌单页面操作", () => {
  it("按歌单顺序入队并保留不同条目中的重复歌曲", async () => {
    const page = await mountLoadedPlaylistPage();

    await page.addPlaylistItemsToNext([203, 201, 202]);
    await page.addPlaylistItemsToQueueEnd([203, 201, 202]);

    expect(addToNextBatches).toEqual([[501, 502, 501]]);
    expect(addToQueueEndBatches).toEqual([[501, 502, 501]]);
  });

  it("移除失败时保留当前列表和封面来源", async () => {
    const page = await mountLoadedPlaylistPage();
    invokeHandler = async (command) => {
      if (command === "list_playlists") return [firstPlaylist, secondPlaylist];
      if (command === "list_playlist_tracks") return firstPlaylistTracks;
      if (command === "remove_playlist_items") throw new Error("database unavailable");
      return undefined;
    };

    await page.removePlaylistItems([201]);

    expect(page.playlistTracks.value).toEqual(firstPlaylistTracks);
    expect(page.coverTrackId.value).toBe(501);
    expect(page.selectedPlaylist.value?.coverTrackId).toBe(501);
    expect(page.playlistActionError.value).toContain("database unavailable");
  });

  it("排序失败时回滚列表顺序和 coverTrackId", async () => {
    const page = await mountLoadedPlaylistPage();
    const reorderRequest = deferred<unknown>();
    invokeHandler = async (command) => {
      if (command === "list_playlists") return [firstPlaylist, secondPlaylist];
      if (command === "list_playlist_tracks") return firstPlaylistTracks;
      if (command === "reorder_playlist_items") return reorderRequest.promise;
      return undefined;
    };

    const reorderPromise = page.reorderPlaylistItems([202, 201, 203]);
    expect(page.playlistTracks.value.map(({ playlistItemId }) => playlistItemId)).toEqual([
      202, 201, 203,
    ]);
    expect(page.coverTrackId.value).toBe(502);
    expect(page.selectedPlaylist.value?.coverTrackId).toBe(502);

    reorderRequest.reject(new Error("database unavailable"));
    await reorderPromise;

    expect(page.playlistTracks.value).toEqual(firstPlaylistTracks);
    expect(page.coverTrackId.value).toBe(501);
    expect(page.selectedPlaylist.value?.coverTrackId).toBe(501);
    expect(page.playlistActionError.value).toContain("database unavailable");
  });

  it("迟到的旧歌单曲目请求不会覆盖新选择", async () => {
    const oldTracksRequest = deferred<unknown>();
    invokeHandler = async (command, args) => {
      if (command === "list_playlists") return [firstPlaylist, secondPlaylist];
      if (command === "list_playlist_tracks") {
        return getNumberArgument(args, "playlistId") === firstPlaylist.id
          ? oldTracksRequest.promise
          : secondPlaylistTracks;
      }
      return undefined;
    };
    const page = mountPlaylistPage();
    await settleRequests();
    expect(
      invokeCalls.some(
        ({ command, args }) =>
          command === "list_playlist_tracks" && args?.playlistId === firstPlaylist.id,
      ),
    ).toBe(true);

    page.selectPlaylist(secondPlaylist);
    await settleRequests();
    expect(page.playlistTracks.value).toEqual(secondPlaylistTracks);

    oldTracksRequest.resolve(firstPlaylistTracks);
    await settleRequests();
    expect(page.selectedPlaylistId.value).toBe(secondPlaylist.id);
    expect(page.playlistTracks.value).toEqual(secondPlaylistTracks);
  });

  it("旧歌单排序 mutation 失败不会污染新选择的曲目或操作状态", async () => {
    const reorderRequest = deferred<unknown>();
    invokeHandler = async (command, args) => {
      if (command === "list_playlists") return [firstPlaylist, secondPlaylist];
      if (command === "list_playlist_tracks") {
        return getNumberArgument(args, "playlistId") === firstPlaylist.id
          ? firstPlaylistTracks
          : secondPlaylistTracks;
      }
      if (command === "reorder_playlist_items") return reorderRequest.promise;
      return undefined;
    };
    const page = await mountLoadedPlaylistPage();
    const reorderPromise = page.reorderPlaylistItems([202, 201, 203]);
    expect(page.coverTrackId.value).toBe(502);

    page.selectPlaylist(secondPlaylist);
    reorderRequest.reject(new Error("old playlist write failed"));
    await reorderPromise;
    await settleRequests();

    expect(page.selectedPlaylistId.value).toBe(secondPlaylist.id);
    expect(page.playlistTracks.value).toEqual(secondPlaylistTracks);
    expect(page.coverTrackId.value).toBe(601);
    expect(page.playlistActionError.value).toBe("");
    expect(page.playlistActionMessage.value).toBe("");
  });
});

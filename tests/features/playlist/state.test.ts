import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { transpileScript, evaluateSource } from "../../support/module/loader";

import { computed, effectScope, isReadonly, nextTick, ref } from "vue";
import type { PlaylistSummary, PlaylistTrackSummary } from "@/features/playlist/types";
import type { PlaybackDisplayTrack } from "@/features/playback/types";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: unknown) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const firstPlaylist: PlaylistSummary = { id: 1, name: "First", trackCount: 3, coverTrackId: 501 };
const secondPlaylist: PlaylistSummary = { id: 2, name: "Second", trackCount: 1, coverTrackId: 601 };
const firstPlaylistTracks: PlaylistTrackSummary[] = [
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
const secondPlaylistTracks: PlaylistTrackSummary[] = [
  {
    playlistItemId: 301,
    trackId: 601,
    title: "Other playlist",
    artist: "Elsewhere",
    album: "Elsewhere",
    durationMs: 130,
  },
];
const availablePlaylists = ref<PlaylistSummary[]>([]);
const selectedPlaylistId = ref<number | null>(null);
const selectedPlaylist = computed(
  () => availablePlaylists.value.find(({ id }) => id === selectedPlaylistId.value) ?? null,
);
let hasLoadedPlaylists = false;
let initialPlaylistId: number | null = 1;
let invokeHandler: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
let invokeCalls: Array<{ command: string; args?: Record<string, unknown> }>;
let playBatches: Array<{
  tracks: readonly PlaybackDisplayTrack[];
  start: string;
  allowSkipped?: boolean;
}>;
let addToNextBatches: number[][];
let addToQueueEndBatches: number[][];
let enqueueResult: () => Promise<boolean>;
const mountedApps: Array<{ unmount: () => void }> = [];

const dependencies: Record<string, unknown> = { vue: Vue };
dependencies["@tauri-apps/api/core"] = {
  invoke: (command: string, args?: Record<string, unknown>) => {
    invokeCalls.push({ command, args });
    return invokeHandler(command, args);
  },
};

dependencies["@/features/playlist/composables/useSelection"] = {
  usePlaylistSelection: () => ({
    availablePlaylists,
    selectedPlaylistId,
    selectedPlaylist,
    setAvailablePlaylists(playlists: PlaylistSummary[]) {
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
    selectPlaylist(playlist: PlaylistSummary) {
      if (availablePlaylists.value.some(({ id }) => id === playlist.id)) {
        selectedPlaylistId.value = playlist.id;
      }
    },
  }),
};

dependencies["@/features/playback/session"] = {
  usePlaybackSession: () => ({
    playTracks: async (
      tracks: readonly PlaybackDisplayTrack[],
      start: string,
      allowSkipped?: boolean,
    ) => {
      playBatches.push({ tracks, start, allowSkipped });
      return true;
    },
    addTracksToNext: async (tracks: readonly { trackId: number }[]) => {
      addToNextBatches.push(tracks.map(({ trackId }) => trackId));
      return enqueueResult();
    },
    addTracksToQueueEnd: async (tracks: readonly { trackId: number }[]) => {
      addToQueueEndBatches.push(tracks.map(({ trackId }) => trackId));
      return true;
    },
  }),
};

const { usePlaylistState: createState } = evaluateSource<
  typeof import("@/features/playlist/composables/useState")
>(
  transpileScript(
    await Bun.file(
      new URL("../../../src/features/playlist/composables/useState.ts", import.meta.url),
    ).text(),
  ),
  dependencies,
);

function createPlaylistState(active = ref(true)) {
  const available = ref(true);
  const scope = effectScope();
  const page = scope.run(() =>
    createState(
      computed(() => (!available.value ? "unavailable" : active.value ? "active" : "background")),
    ),
  );
  if (!page) throw new Error("Playlist state was not created.");
  mountedApps.push({
    unmount: () => {
      available.value = false;
      scope.stop();
    },
  });
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

async function createLoadedPlaylistState() {
  const page = createPlaylistState();
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
  playBatches = [];
  addToNextBatches = [];
  addToQueueEndBatches = [];
  enqueueResult = async () => true;
  setDefaultInvokeHandler();
});

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
});

describe("歌单状态与动作", () => {
  it("不可用后清除加载状态，强制刷新及迟到查询都不能写回", async () => {
    const page = createPlaylistState(ref(false));
    const pending = deferred<unknown>();
    invokeHandler = async () => pending.promise;
    const refresh = page.refreshPlaylists(undefined, true);
    expect(page.isLoadingPlaylists.value).toBe(true);
    for (const app of mountedApps.splice(0)) app.unmount();
    expect(page.isLoadingPlaylists.value).toBe(false);
    pending.resolve([firstPlaylist, secondPlaylist]);
    await refresh;
    await page.refreshPlaylists(undefined, true);
    expect(page.playlists.value).toEqual([]);
    expect(invokeCalls.map(({ command }) => command)).toEqual(["list_playlists"]);
  });

  it("不同歌单可并发编辑，所有数据变更结束后才执行合并刷新", async () => {
    const page = await createLoadedPlaylistState();
    const firstRename = deferred<unknown>();
    const secondRename = deferred<unknown>();
    const renamedFirst = { ...firstPlaylist, name: "Updated first" };
    const renamedSecond = { ...secondPlaylist, name: "Updated second" };
    invokeCalls = [];
    invokeHandler = async (command, args) => {
      if (command === "rename_playlist") {
        return args?.playlistId === 1 ? firstRename.promise : secondRename.promise;
      }
      if (command === "list_playlists") return [renamedFirst, renamedSecond];
      if (command === "list_playlist_tracks") return firstPlaylistTracks;
      return undefined;
    };
    const first = page.renamePlaylist(1, renamedFirst.name);
    const second = page.renamePlaylist(2, renamedSecond.name);
    expect(page.pendingPlaylistIds.value).toEqual([1, 2]);
    await page.refreshPlaylists(undefined, true);
    firstRename.resolve(undefined);
    await first;
    expect(page.pendingPlaylistIds.value).toEqual([2]);
    expect(invokeCalls.map(({ command }) => command)).toEqual([
      "rename_playlist",
      "rename_playlist",
    ]);
    secondRename.resolve(undefined);
    await second;
    await settleRequests();
    expect(page.pendingPlaylistIds.value).toEqual([]);
    expect(page.playlists.value).toEqual([renamedFirst, renamedSecond]);
    expect(invokeCalls.map(({ command }) => command)).toEqual([
      "rename_playlist",
      "rename_playlist",
      "list_playlists",
      "list_playlist_tracks",
    ]);
  });

  it("查询状态只读，调用方不能绕过完整操作修改摘要或条目", async () => {
    const page = await createLoadedPlaylistState();
    expect(isReadonly(page.playlists)).toBe(true);
    expect(isReadonly(page.playlists.value)).toBe(true);
    expect(isReadonly(page.playlists.value[0])).toBe(true);
    expect(isReadonly(page.playlistTracks.value)).toBe(true);
    expect(isReadonly(page.selectedPlaylistId)).toBe(true);
  });

  it("后台强制刷新摘要和已选歌单，不可用后停止查询", async () => {
    const active = ref(false);
    const page = createPlaylistState(active);
    expect(invokeCalls).toEqual([]);
    await page.refreshPlaylists(undefined, true);
    await settleRequests();
    expect(page.playlists.value).toEqual([firstPlaylist, secondPlaylist]);
    expect(page.playlistTracks.value).toEqual(firstPlaylistTracks);
    expect(invokeCalls.map(({ command }) => command)).toEqual([
      "list_playlists",
      "list_playlist_tracks",
    ]);
    for (const app of mountedApps.splice(0)) app.unmount();
    const before = invokeCalls.length;
    await page.refreshPlaylists(undefined, true);
    await settleRequests();
    expect(invokeCalls).toHaveLength(before);
  });

  it("切换到后台后仍允许强制刷新，并忽略迟到的旧查询", async () => {
    const active = ref(true);
    const page = createPlaylistState(active);
    await settleRequests();
    active.value = false;
    const stale = deferred<unknown>();
    let requests = 0;
    const renamed = { ...firstPlaylist, name: "Updated" };
    invokeHandler = async (command) => {
      if (command === "list_playlists") return ++requests === 1 ? stale.promise : [renamed];
      if (command === "list_playlist_tracks") return firstPlaylistTracks;
      return undefined;
    };
    const staleRefresh = page.refreshPlaylists(undefined, true);
    await page.refreshPlaylists(undefined, true);
    await settleRequests();
    stale.resolve([firstPlaylist]);
    await staleRefresh;
    await settleRequests();
    expect(page.playlists.value).toEqual([renamed]);
    expect(page.playlistTracks.value).toEqual(firstPlaylistTracks);
  });

  it("编辑期间的多次变更合并为一次后台刷新，等待回滚完成", async () => {
    const active = ref(true);
    const page = createPlaylistState(active);
    await settleRequests();
    active.value = false;
    const reorderRequest = deferred<unknown>();
    invokeHandler = async (command) => {
      if (command === "reorder_playlist_items") return reorderRequest.promise;
      if (command === "list_playlists") return [firstPlaylist, secondPlaylist];
      if (command === "list_playlist_tracks") return firstPlaylistTracks;
      return undefined;
    };
    const before = invokeCalls.length;
    const reorder = page.reorderPlaylistItems([203, 202, 201]);
    expect(page.playlistTracks.value.map(({ playlistItemId }) => playlistItemId)).toEqual([
      203, 202, 201,
    ]);
    await page.refreshPlaylists(undefined, true);
    await page.refreshPlaylists(undefined, true);
    expect(invokeCalls.slice(before).map(({ command }) => command)).toEqual([
      "reorder_playlist_items",
    ]);
    reorderRequest.reject(new Error("database busy"));
    await reorder;
    await settleRequests();
    expect(page.playlistTracks.value).toEqual(firstPlaylistTracks);
    expect(invokeCalls.slice(before).map(({ command }) => command)).toEqual([
      "reorder_playlist_items",
      "list_playlists",
      "list_playlist_tracks",
    ]);
  });

  it("plays the entire visible order from the requested row or the first displayed row", async () => {
    const page = await createLoadedPlaylistState();
    const order = [203, 201, 202];
    await page.playTrackFromPlaylist(202, order);
    await page.playPlaylistFromPage(order);
    expect(playBatches.map(({ tracks }) => tracks.map((track) => track.rowKey))).toEqual([
      ["playlist-item:203", "playlist-item:201", "playlist-item:202"],
      ["playlist-item:203", "playlist-item:201", "playlist-item:202"],
    ]);
    expect(playBatches.map(({ tracks }) => tracks.map((track) => track.trackId))).toEqual([
      [501, 501, 502],
      [501, 501, 502],
    ]);
    expect(playBatches.map(({ start }) => start)).toEqual([
      "playlist-item:202",
      "playlist-item:203",
    ]);
    expect(playBatches[1]?.allowSkipped).toBe(false);
    expect(page.playlistTracks.value).toEqual(firstPlaylistTracks);
  });

  it("rejects stale or invalid visible orders without falling back to original order", async () => {
    const page = await createLoadedPlaylistState();
    for (const order of [[201], [201, 201, 203], [201, 202, 999], []]) {
      await page.playTrackFromPlaylist(201, order);
      await page.playPlaylistFromPage(order);
    }
    await page.playTrackFromPlaylist(999, [201, 202, 203]);
    expect(playBatches).toEqual([]);
  });

  it("按用户提供的可见顺序入队并保留不同条目中的重复歌曲", async () => {
    const page = await createLoadedPlaylistState();

    await page.addPlaylistItemsToNext([203, 201, 202]);
    await page.addPlaylistItemsToQueueEnd([203, 201, 202]);

    expect(addToNextBatches).toEqual([[501, 501, 502]]);
    expect(addToQueueEndBatches).toEqual([[501, 501, 502]]);
  });

  it("移除失败时保留当前列表和封面来源", async () => {
    const page = await createLoadedPlaylistState();
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

  for (const background of [false, true]) {
    it(`条目集合冲突按错误码恢复真实条目（${background ? "后台" : "活跃"}）`, async () => {
      const active = ref(true);
      const page = createPlaylistState(active);
      await settleRequests();
      const remainingTracks = firstPlaylistTracks.filter(
        ({ playlistItemId }) => playlistItemId !== 202,
      );
      const updatedSummary = { ...firstPlaylist, trackCount: 2 };
      invokeCalls = [];
      invokeHandler = async (command) => {
        if (command === "reorder_playlist_items") {
          throw { code: "item_set_mismatch", message: "歌单条目已变化，请重新加载。" };
        }
        if (command === "list_playlists") return [updatedSummary, secondPlaylist];
        if (command === "list_playlist_tracks") return remainingTracks;
        return undefined;
      };
      const reorder = page.reorderPlaylistItems([202, 201, 203]);
      if (background) active.value = false;
      await reorder;
      await settleRequests();
      expect(invokeCalls.map(({ command }) => command)).toEqual([
        "reorder_playlist_items",
        "list_playlists",
        "list_playlist_tracks",
      ]);
      expect(page.playlistTracks.value).toEqual(remainingTracks);
      expect(page.selectedPlaylist.value?.trackCount).toBe(2);
      expect(page.coverTrackId.value).toBe(501);
      expect(page.playlistActionError.value).toContain("歌单条目已变化");
    });
  }

  it("普通排序错误即使包含旧冲突文案也只回滚，不触发刷新", async () => {
    const page = await createLoadedPlaylistState();
    const message = "Ordered playlist item IDs must exactly match playlist 1";
    invokeCalls = [];
    invokeHandler = async () => {
      throw { code: "failed", message };
    };

    await page.reorderPlaylistItems([202, 201, 203]);
    await settleRequests();

    expect(invokeCalls.map(({ command }) => command)).toEqual(["reorder_playlist_items"]);
    expect(page.playlistTracks.value).toEqual(firstPlaylistTracks);
    expect(page.selectedPlaylist.value).toEqual(firstPlaylist);
    expect(page.playlistActionError.value).toContain(message);
  });

  it("冲突刷新等待其他歌单编辑结束，保留后台强制刷新要求", async () => {
    const active = ref(true);
    const page = createPlaylistState(active);
    await settleRequests();
    const reorderRequest = deferred<unknown>();
    const renameRequest = deferred<unknown>();
    const remainingTracks = firstPlaylistTracks.filter(
      ({ playlistItemId }) => playlistItemId !== 202,
    );
    invokeCalls = [];
    invokeHandler = async (command) => {
      if (command === "reorder_playlist_items") return reorderRequest.promise;
      if (command === "rename_playlist") return renameRequest.promise;
      if (command === "list_playlists") {
        return [{ ...firstPlaylist, trackCount: 2 }, secondPlaylist];
      }
      if (command === "list_playlist_tracks") return remainingTracks;
      return undefined;
    };

    const reorder = page.reorderPlaylistItems([202, 201, 203]);
    const rename = page.renamePlaylist(2, "Updated second");
    active.value = false;
    reorderRequest.reject({ code: "item_set_mismatch", message: "条目集合已变化" });
    await reorder;
    await settleRequests();
    expect(page.playlistTracks.value).toEqual(firstPlaylistTracks);
    expect(page.selectedPlaylist.value).toEqual(firstPlaylist);
    expect(invokeCalls.map(({ command }) => command)).toEqual([
      "reorder_playlist_items",
      "rename_playlist",
    ]);

    renameRequest.reject(new Error("database busy"));
    await rename;
    await settleRequests();
    expect(invokeCalls.map(({ command }) => command)).toEqual([
      "reorder_playlist_items",
      "rename_playlist",
      "list_playlists",
      "list_playlist_tracks",
    ]);
    expect(page.playlistTracks.value).toEqual(remainingTracks);
    expect(page.selectedPlaylist.value?.trackCount).toBe(2);
  });

  it("旧歌单排序冲突只刷新新选择，不回写旧条目或错误", async () => {
    const page = await createLoadedPlaylistState();
    const reorderRequest = deferred<unknown>();
    invokeCalls = [];
    invokeHandler = async (command, args) => {
      if (command === "reorder_playlist_items") return reorderRequest.promise;
      if (command === "list_playlists") return [firstPlaylist, secondPlaylist];
      if (command === "list_playlist_tracks") {
        expect(args?.playlistId).toBe(2);
        return secondPlaylistTracks;
      }
      return undefined;
    };

    const reorder = page.reorderPlaylistItems([202, 201, 203]);
    page.selectPlaylist(secondPlaylist);
    reorderRequest.reject({ code: "item_set_mismatch", message: "旧歌单条目已变化" });
    await reorder;
    await settleRequests();

    expect(invokeCalls.map(({ command }) => command)).toEqual([
      "reorder_playlist_items",
      "list_playlists",
      "list_playlist_tracks",
    ]);
    expect(page.selectedPlaylistId.value).toBe(2);
    expect(page.playlistTracks.value).toEqual(secondPlaylistTracks);
    expect(page.coverTrackId.value).toBe(601);
    expect(page.playlistActionError.value).toBe("");
  });

  it("入队和数据编辑共用歌单动作锁，完成后才允许编辑", async () => {
    const page = await createLoadedPlaylistState();
    const pending = deferred<boolean>();
    enqueueResult = () => pending.promise;
    const enqueue = page.addPlaylistItemsToNext([201]);
    expect(page.pendingPlaylistIds.value).toEqual([1]);
    expect(page.isPlaylistActionPending.value).toBe(true);
    const before = invokeCalls.length;
    expect((await page.renamePlaylist(1, "Blocked")).status).toBe("error");
    await page.reorderPlaylistItems([202, 201, 203]);
    await page.removePlaylistItems([201]);
    expect(invokeCalls).toHaveLength(before);
    pending.resolve(true);
    await enqueue;
    expect(page.pendingPlaylistIds.value).toEqual([]);
    expect(page.isPlaylistActionPending.value).toBe(false);
    expect((await page.renamePlaylist(1, "Allowed")).status).toBe("success");
  });

  it("排序失败时回滚列表顺序和 coverTrackId", async () => {
    const page = await createLoadedPlaylistState();
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
    expect(invokeCalls.filter(({ command }) => command === "list_playlists")).toHaveLength(1);
    page.selectPlaylist(secondPlaylist);
    expect(page.playlistActionError.value).toBe("");
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
    const page = createPlaylistState();
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
    const page = await createLoadedPlaylistState();
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
  });

  it("重命名会清理名称、保持当前选择且不修改播放队列", async () => {
    const page = await createLoadedPlaylistState();
    const renamedPlaylist = { ...firstPlaylist, name: "Renamed" };
    let renameArguments: Record<string, unknown> | undefined;
    invokeHandler = async (command, args) => {
      if (command === "list_playlists") return [renamedPlaylist, secondPlaylist];
      if (command === "list_playlist_tracks") return firstPlaylistTracks;
      if (command === "rename_playlist") renameArguments = args;
      return undefined;
    };

    const result = await page.renamePlaylist(firstPlaylist.id, "  Renamed  ");
    await settleRequests();

    expect(result).toEqual({ status: "success" });
    expect(renameArguments).toEqual({ playlistId: firstPlaylist.id, name: "Renamed" });
    expect(page.playlists.value[0]?.name).toBe("Renamed");
    expect(page.selectedPlaylistId.value).toBe(firstPlaylist.id);
    expect(addToNextBatches).toEqual([]);
    expect(addToQueueEndBatches).toEqual([]);
  });

  it("删除非当前歌单保留右侧选择和曲目", async () => {
    const page = await createLoadedPlaylistState();
    page.selectPlaylist(secondPlaylist);
    await settleRequests();
    invokeHandler = async () => undefined;

    const result = await page.deletePlaylist(firstPlaylist.id);

    expect(result).toEqual({ status: "success" });
    expect(page.playlists.value.map(({ id }) => id)).toEqual([secondPlaylist.id]);
    expect(page.selectedPlaylistId.value).toBe(secondPlaylist.id);
    expect(page.selectedPlaylist.value).toEqual(secondPlaylist);
    expect(page.playlistTracks.value).toEqual(secondPlaylistTracks);
    expect(addToNextBatches).toEqual([]);
    expect(addToQueueEndBatches).toEqual([]);
  });

  it("删除当前歌单清空选择而不自动选择相邻歌单", async () => {
    const page = await createLoadedPlaylistState();
    invokeHandler = async () => undefined;

    const result = await page.deletePlaylist(firstPlaylist.id);

    expect(result).toEqual({ status: "success" });
    expect(page.playlists.value.map(({ id }) => id)).toEqual([secondPlaylist.id]);
    expect(page.selectedPlaylistId.value).toBeNull();
    expect(page.selectedPlaylist.value).toBeNull();
    expect(page.playlistTracks.value).toEqual([]);
    expect(
      invokeCalls.some(
        ({ command, args }) =>
          command === "list_playlist_tracks" && args?.playlistId === secondPlaylist.id,
      ),
    ).toBe(false);
    expect(addToNextBatches).toEqual([]);
    expect(addToQueueEndBatches).toEqual([]);
  });

  it("重命名使迟到的旧列表读取失效并保持新上下文", async () => {
    const page = await createLoadedPlaylistState();
    const staleRead = deferred<unknown>();
    const renameRequest = deferred<unknown>();
    let listCalls = 0;
    const renamedPlaylist = { ...firstPlaylist, name: "Renamed" };
    invokeHandler = async (command) => {
      if (command === "list_playlists") {
        listCalls += 1;
        return listCalls === 1 ? staleRead.promise : [renamedPlaylist, secondPlaylist];
      }
      if (command === "list_playlist_tracks") return firstPlaylistTracks;
      if (command === "rename_playlist") return renameRequest.promise;
      return undefined;
    };

    const staleRefresh = page.refreshPlaylists(undefined, true);
    const rename = page.renamePlaylist(firstPlaylist.id, "Renamed");
    renameRequest.resolve(undefined);
    await rename;
    await settleRequests();
    staleRead.resolve([firstPlaylist, secondPlaylist]);
    await staleRefresh;
    await settleRequests();

    expect(listCalls).toBe(2);
    expect(page.playlists.value[0]?.name).toBe("Renamed");
    expect(page.selectedPlaylistId.value).toBe(firstPlaylist.id);
    expect(page.playlistTracks.value).toEqual(firstPlaylistTracks);
    expect(addToNextBatches).toEqual([]);
    expect(addToQueueEndBatches).toEqual([]);
  });

  it("迟到的删除结果不会覆盖新选择", async () => {
    const page = await createLoadedPlaylistState();
    const deleteRequest = deferred<unknown>();
    let serverPlaylists = [firstPlaylist, secondPlaylist];
    invokeHandler = async (command, args) => {
      if (command === "list_playlists") return serverPlaylists;
      if (command === "list_playlist_tracks") {
        return getNumberArgument(args, "playlistId") === firstPlaylist.id
          ? firstPlaylistTracks
          : secondPlaylistTracks;
      }
      if (command === "delete_playlist") {
        await deleteRequest.promise;
        serverPlaylists = serverPlaylists.filter(({ id }) => id !== firstPlaylist.id);
      }
      return undefined;
    };

    const deletion = page.deletePlaylist(firstPlaylist.id);
    page.selectPlaylist(secondPlaylist);
    await settleRequests();
    deleteRequest.resolve(undefined);
    const result = await deletion;
    await settleRequests();

    expect(result).toEqual({ status: "success" });
    expect(page.playlists.value.map(({ id }) => id)).toEqual([secondPlaylist.id]);
    expect(page.selectedPlaylistId.value).toBe(secondPlaylist.id);
    expect(page.playlistTracks.value).toEqual(secondPlaylistTracks);
    expect(page.playlistActionError.value).toBe("");
    expect(addToNextBatches).toEqual([]);
    expect(addToQueueEndBatches).toEqual([]);
  });
});

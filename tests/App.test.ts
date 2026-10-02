import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "./support/moduleLoader";
import { createHostNode, createHostRenderer } from "./support/hostRenderer";
import type { HostNode } from "./support/hostRenderer";
import type { Playlist } from "@/types/playlist";
import { notifications, notify } from "@/notification/center";
import { useNotification } from "@/notification/useNotification";
import { loadLibraryWorkspaceModules } from "./library/workspaceModules";
import { loadPlaylistWorkspaceModules } from "./playlist/workspaceModules";

const playlist: Playlist = {
  id: 7,
  name: "Favorites",
  trackCount: 1,
  coverTrackId: 41,
};
const track = {
  id: 41,
  title: "Song",
  artist: "Artist",
  album: "Album",
  durationMs: 100,
};
type RemovalResult =
  | { status: "not-deleted"; message: string }
  | { status: "deleted" }
  | { status: "deleted-queue-sync-failed"; message: string };

let removalResult: RemovalResult = { status: "deleted" };
let removalCalls = 0;
let playlistRefreshCalls = 0;
let dialogShowCalls = 0;
let dialogCloseCalls = 0;
let libraryPageCreations = 0;
let playlistPageCreations = 0;
let layoutMounts = 0;
let layoutUnmounts = 0;
const mountedApps: Array<{ unmount: () => void }> = [];
const libraryTrackActionError = Vue.ref("");
const libraryTrackActionMessage = Vue.ref("");
const libraryTrackActionMessageType = Vue.ref<"success" | "warning">("success");
const libraryTrackActionPending = Vue.ref(false);
const playlistActionError = Vue.ref("");
const artistsError = Vue.ref("");
const activePage = Vue.ref("Library");

async function createComponent(source: string) {
  const output = compileSfc(source, "src/App.vue", { id: "app-test" });
  const useLibraryPage = () => {
    libraryPageCreations += 1;
    return {
      artists: Vue.ref([]),
      albums: Vue.ref([]),
      tracks: Vue.ref([track]),
      isLoadingArtists: Vue.ref(false),
      isLoadingAlbums: Vue.ref(false),
      isLoadingTracks: Vue.ref(false),
      artistsError,
      albumsError: Vue.ref(""),
      tracksError: Vue.ref(""),
      isTrackActionPending: libraryTrackActionPending,
      trackActionError: libraryTrackActionError,
      trackActionMessage: libraryTrackActionMessage,
      trackActionMessageType: libraryTrackActionMessageType,
      currentTrack: Vue.ref(null),
      activeQueueRowKey: Vue.ref(null),
      selectedGroup: Vue.ref({ albumArtist: "Artist", albumCount: 1 }),
      selectedAlbum: Vue.ref({ albumArtist: "Artist", album: "Album" }),
      selectArtist: () => {},
      selectAlbum: () => {},
      playTrackFromLibrary: () => {},
      playAlbumFromLibrary: () => {},
      addTracksToNext: () => {},
      addTracksToQueueEnd: () => {},
      addTracksToPlaylist: async () => ({ successfulTrackIds: [], failures: [] }),
      removeTrackFromLibrary: async () => {
        removalCalls += 1;
        if (removalResult.status === "not-deleted") {
          libraryTrackActionError.value = removalResult.message;
        } else if (removalResult.status === "deleted-queue-sync-failed") {
          libraryTrackActionError.value = removalResult.message;
        }
        return removalResult;
      },
    };
  };
  const usePlaylistPage = () => {
    playlistPageCreations += 1;
    return {
      playlists: Vue.ref([playlist]),
      selectedPlaylistId: Vue.ref(playlist.id),
      selectedPlaylist: Vue.ref(playlist),
      playlistTracks: Vue.ref([]),
      isLoadingPlaylists: Vue.ref(false),
      isLoadingPlaylistTracks: Vue.ref(false),
      pendingPlaylistIds: Vue.ref([]),
      playlistsError: Vue.ref(""),
      playlistTracksError: Vue.ref(""),
      isPlaylistActionPending: Vue.ref(false),
      playlistActionError,
      coverTrackId: Vue.ref(playlist.coverTrackId),
      isCoverPending: Vue.ref(false),
      selectPlaylist: () => {},
      renamePlaylist: async () => ({ status: "success" }),
      deletePlaylist: async () => ({ status: "success" }),
      playTrackFromPlaylist: () => {},
      playPlaylistFromPage: () => {},
      addPlaylistItemsToNext: () => {},
      addPlaylistItemsToQueueEnd: () => {},
      removePlaylistItems: () => {},
      reorderPlaylistItems: () => {},
      refreshPlaylists: async () => {
        playlistRefreshCalls += 1;
      },
    };
  };
  const passiveComponent = Vue.defineComponent({ setup: () => () => null });
  const AlbumBrowser = Vue.defineComponent({
    props: ["trackActionError"],
    setup(props, { emit }) {
      return () =>
        Vue.h("div", [
          Vue.h(
            "button",
            { "data-test": "request-delete", onClick: () => emit("delete-track", track.id) },
            "Delete",
          ),
          props.trackActionError
            ? Vue.h("p", { "data-test": "library-error" }, props.trackActionError)
            : null,
        ]);
    },
  });
  const DeleteTrackDialog = Vue.defineComponent({
    props: ["track", "error"],
    setup(props, { emit, expose }) {
      expose({
        show: () => {
          dialogShowCalls += 1;
        },
        close: () => {
          dialogCloseCalls += 1;
        },
      });
      return () =>
        Vue.h("div", { "data-test": "delete-dialog" }, [
          props.error ? Vue.h("p", { "data-test": "dialog-error" }, props.error) : null,
          Vue.h(
            "button",
            {
              "data-test": "confirm-delete",
              onClick: () => emit("confirm", props.track.id),
            },
            "Confirm",
          ),
        ]);
    },
  });
  const WorkspaceLayout = Vue.defineComponent({
    setup(_, { slots }) {
      Vue.onMounted(() => {
        layoutMounts += 1;
      });
      Vue.onUnmounted(() => {
        layoutUnmounts += 1;
      });
      return () => Vue.h("main", slots.center?.());
    },
  });
  const defaultModule = (component: Vue.Component) => ({ __esModule: true, default: component });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/notification/center": { notify },
    "@/notification/useNotification": { useNotification },
    "@/notification/ui/NotificationHost.vue": defaultModule(passiveComponent),
    "@/navigation/activePage": {
      usePersistentActivePage: () => ({ activePage }),
    },
    "@/library/usePage": { useLibraryPage },
    "@/playlist/usePage": { usePlaylistPage },
    "@/playback/session": {
      usePlaybackSession: () => ({ state: { activeQueueRowKey: Vue.ref(null) } }),
    },
    "@/library/ui/AlbumBrowser.vue": defaultModule(AlbumBrowser),
    "@/library/ui/DeleteTrackDialog.vue": defaultModule(DeleteTrackDialog),
    "@/layout/WorkspaceLayout.vue": defaultModule(WorkspaceLayout),
  };
  for (const name of [
    "@/playing/PlayingPage.vue",
    "@/playback/ui/PlaybackBar.vue",
    "@/library/ui/ArtistList.vue",
    "@/library/ui/DeleteAlbumDialog.vue",
    "@/playlist/ui/CreatePlaylistDialog.vue",
    "@/playlist/ui/PlaylistBrowser.vue",
    "@/playlist/ui/PlaylistList.vue",
    "@/playlist/ui/RenamePlaylistDialog.vue",
    "@/playlist/ui/DeletePlaylistDialog.vue",
    "@/navigation/TopBar.vue",
  ]) {
    modules[name] = defaultModule(passiveComponent);
  }
  await loadLibraryWorkspaceModules(modules);
  await loadPlaylistWorkspaceModules(modules);
  return evaluateModule<{ default: Vue.Component }>(output, modules).default;
}

const appComponent = await createComponent(
  await Bun.file(new URL("../src/App.vue", import.meta.url)).text(),
);

function mountApp() {
  const renderer = createHostRenderer(createHostNode);
  const root = createHostNode("root");
  const app = renderer.createApp(appComponent);
  app.mount(root);
  mountedApps.push(app);
  return root;
}

function findByTestId(node: HostNode, id: string): HostNode | null {
  if (node.props["data-test"] === id) return node;
  for (const child of node.children) {
    const match = findByTestId(child, id);
    if (match) return match;
  }
  return null;
}

function click(node: HostNode | null) {
  const handler = node?.props.onClick;
  if (typeof handler === "function") handler();
}

async function settleApp() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  await Vue.nextTick();
}

beforeEach(() => {
  removalResult = { status: "deleted" };
  removalCalls = 0;
  playlistRefreshCalls = 0;
  dialogShowCalls = 0;
  dialogCloseCalls = 0;
  libraryPageCreations = 0;
  playlistPageCreations = 0;
  layoutMounts = 0;
  layoutUnmounts = 0;
  libraryTrackActionError.value = "";
  libraryTrackActionMessage.value = "";
  libraryTrackActionMessageType.value = "success";
  libraryTrackActionPending.value = false;
  playlistActionError.value = "";
  artistsError.value = "";
  activePage.value = "Library";
  notifications.clear();
});

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  notifications.clear();
});

describe("App workspace lifecycle", () => {
  it("keeps both feature instances and the shared layout mounted across page changes", async () => {
    mountApp();
    for (const page of ["Playlist", "Playing", "Library"]) {
      activePage.value = page;
      await Vue.nextTick();
    }
    expect(libraryPageCreations).toBe(1);
    expect(playlistPageCreations).toBe(1);
    expect(layoutMounts).toBe(1);
    expect(layoutUnmounts).toBe(0);
  });
});

describe("App notification integration", () => {
  it("reports album/track success and partial failures without inline messages", async () => {
    const root = mountApp();
    libraryTrackActionPending.value = true;
    libraryTrackActionMessage.value = "已成功添加 2 首到播放列表。";
    await Vue.nextTick();
    expect(notifications.items.value).toEqual([]);
    libraryTrackActionPending.value = false;
    await Vue.nextTick();
    expect(notifications.items.value[0]).toMatchObject({
      type: "success",
      message: libraryTrackActionMessage.value,
    });
    expect(findByTestId(root, "library-error")).toBeNull();
    notifications.clear();
    libraryTrackActionMessageType.value = "warning";
    libraryTrackActionMessage.value = "已成功添加 1 首；1 首失败：permission denied";
    await Vue.nextTick();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "warning",
      message: libraryTrackActionMessage.value,
    });
  });

  it("keeps dismissed playlist failures in business state and preserves toasts across page changes", async () => {
    mountApp();
    playlistActionError.value = "保存歌单排序失败：database unavailable";
    await Vue.nextTick();
    expect(notifications.items.value).toHaveLength(1);
    activePage.value = "Playing";
    await Vue.nextTick();
    expect(notifications.items.value).toHaveLength(1);
    notifications.dismiss(notifications.items.value[0].id);
    await Vue.nextTick();
    expect(playlistActionError.value).toContain("database unavailable");
    expect(notifications.items.value).toEqual([]);
  });

  it("reports a load failure exactly once, even after unrelated state changes", async () => {
    mountApp();
    artistsError.value = "读取专辑演出者失败：database unavailable";
    await Vue.nextTick();
    expect(notifications.items.value).toHaveLength(1);
    activePage.value = "Playlist";
    await Vue.nextTick();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0].count).toBe(1);
  });
});

describe("App track deletion confirmation", () => {
  it("preserves a library confirmation dialog across page changes", async () => {
    const root = mountApp();
    click(findByTestId(root, "request-delete"));
    await settleApp();
    activePage.value = "Playing";
    await settleApp();
    expect(findByTestId(root, "delete-dialog")).not.toBeNull();
    expect(dialogCloseCalls).toBe(0);
    click(findByTestId(root, "confirm-delete"));
    await settleApp();
    expect(removalCalls).toBe(1);
    expect(playlistRefreshCalls).toBe(0);
    expect(findByTestId(root, "delete-dialog")).toBeNull();
  });

  it("keeps the dialog open and displays the database error when deletion did not happen", async () => {
    removalResult = { status: "not-deleted", message: "数据库不可用" };
    const root = mountApp();
    click(findByTestId(root, "request-delete"));
    await Vue.nextTick();
    await Vue.nextTick();

    click(findByTestId(root, "confirm-delete"));
    await settleApp();

    expect(dialogShowCalls).toBe(1);
    expect(dialogCloseCalls).toBe(0);
    expect(findByTestId(root, "delete-dialog")).not.toBeNull();
    expect(findByTestId(root, "dialog-error")).toBeNull();
    expect(notifications.items.value.map(({ message }) => message)).toEqual(["数据库不可用"]);
    notifications.dismiss(notifications.items.value[0].id);
    expect(libraryTrackActionError.value).toBe("数据库不可用");
    expect(findByTestId(root, "delete-dialog")).not.toBeNull();
    expect(playlistRefreshCalls).toBe(0);
  });

  it("closes after partial success and keeps the warning visible without retrying deletion", async () => {
    const warning = "曲库索引已删除，但停止当前播放失败：device busy";
    removalResult = { status: "deleted-queue-sync-failed", message: warning };
    const root = mountApp();
    click(findByTestId(root, "request-delete"));
    await Vue.nextTick();
    await Vue.nextTick();

    click(findByTestId(root, "confirm-delete"));
    await settleApp();

    expect(dialogCloseCalls).toBe(1);
    expect(findByTestId(root, "delete-dialog")).toBeNull();
    expect(findByTestId(root, "library-error")).toBeNull();
    expect(notifications.items.value.map(({ message }) => message)).toEqual([warning]);
    expect(removalCalls).toBe(1);
    expect(playlistRefreshCalls).toBe(0);
  });
});

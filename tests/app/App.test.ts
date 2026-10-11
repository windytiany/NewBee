import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../support/module/loader";

import { createHostNode, createHostRenderer } from "../support/host/renderer";
import type { HostNode } from "../support/host/renderer";
import type { PlaylistSummary } from "@/features/playlist/types";
import { notifications, notify } from "@/shared/notifications/center";
import { useNotification } from "@/shared/notifications/useNotification";
import { loadLibraryModules } from "../features/library/modules";
import { loadPlaylistModules } from "../features/playlist/modules";

const playlist: PlaylistSummary = {
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
const libraryTrackActionRemoval = Vue.ref<{
  deletedCount: number;
  failedCount: number;
  queueSyncFailed: boolean;
} | null>(null);
const libraryTrackActionPending = Vue.ref(false);
const playlistActionError = Vue.ref("");
const artistsError = Vue.ref("");
const activePage = Vue.ref("Library");

async function createComponent(source: string) {
  const output = compileSfc(source, "src/app/App.vue", { id: "app-test" });
  const useLibraryBrowser = () => {
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
      trackActionRemoval: libraryTrackActionRemoval,
      trackActionMessage: libraryTrackActionMessage,
      trackActionMessageType: libraryTrackActionMessageType,
      currentTrack: Vue.ref(null),
      activeQueueRowKey: Vue.ref(null),
      playbackStatus: Vue.ref({ isPlaying: false }),
      isPlaybackCommandPending: Vue.ref(false),
      toggleCurrentAlbumPlayback: async () => false,
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
        libraryTrackActionRemoval.value = {
          deletedCount: removalResult.status === "not-deleted" ? 0 : 1,
          failedCount: removalResult.status === "not-deleted" ? 1 : 0,
          queueSyncFailed: removalResult.status === "deleted-queue-sync-failed",
        };
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
  const AppShell = Vue.defineComponent({
    setup(_, { slots }) {
      Vue.onMounted(() => {
        layoutMounts += 1;
      });
      Vue.onUnmounted(() => {
        layoutUnmounts += 1;
      });
      return () => Vue.h("main", [slots.workspace?.(), slots.playing?.()]);
    },
  });
  const defaultModule = (component: Vue.Component) => ({ __esModule: true, default: component });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/shared/notifications/center": { notify },
    "@/shared/notifications/useNotification": { useNotification },
    "@/features/metadata/manual/components/TagEditorDialog.vue": defaultModule(passiveComponent),
    "@/features/lyrics/download/LyricsDownloadDialog.vue": defaultModule(passiveComponent),
    "@/features/metadata/releases/components/ReleaseTagDialog.vue": defaultModule(passiveComponent),
    "@/shared/notifications/NotificationHost.vue": defaultModule(passiveComponent),
    "@/app/pages": {
      usePersistentActivePage: () => ({ activePage }),
    },
    "@/features/library/browser/useBrowser": { useLibraryBrowser },
    "@/features/playlist/composables/usePage": { usePlaylistPage },
    "@/features/playback/session": {
      usePlaybackSession: () => ({ state: { activeQueueRowKey: Vue.ref(null) } }),
    },
    "@/features/library/browser/albums/AlbumBrowser.vue": defaultModule(AlbumBrowser),
    "@/features/library/components/dialogs/DeleteTrackDialog.vue": defaultModule(DeleteTrackDialog),
    "@/app/shell/AppShell.vue": defaultModule(AppShell),
  };
  for (const name of [
    "@/features/playback/pages/NowPlayingPage.vue",
    "@/features/playback/controls/PlaybackBar.vue",
    "@/features/library/browser/artists/ArtistList.vue",
    "@/features/library/components/dialogs/DeleteAlbumDialog.vue",
    "@/features/playlist/creation/CreatePlaylistDialog.vue",
    "@/features/playlist/tracks/PlaylistBrowser.vue",
    "@/features/playlist/list/PlaylistList.vue",
    "@/features/playlist/components/dialogs/RenamePlaylistDialog.vue",
    "@/features/playlist/components/dialogs/DeletePlaylistDialog.vue",
    "@/app/shell/TitleBar.vue",
    "@/shared/components/SidePane.vue",
    "@/features/playback/queue/components/QueuePanel.vue",
    "@/features/playback/current/TrackInfoPanel.vue",
  ]) {
    modules[name] = defaultModule(passiveComponent);
  }
  modules["@/features/settings/shortcuts/useShortcuts"] = { useShortcuts: () => {} };
  await loadLibraryModules(modules);
  await loadPlaylistModules(modules);
  return evaluateSource<{ default: Vue.Component }>(output, modules).default;
}

const appComponent = await createComponent(
  await Bun.file(new URL("../../src/app/App.vue", import.meta.url)).text(),
);

function mountApp() {
  const renderer = createHostRenderer<HostNode>((type, text) =>
    Object.assign(createHostNode(type, text), { style: {} }),
  );
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
  libraryTrackActionRemoval.value = null;
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

  it("notifies load failures without changing business state or duplicating on page changes", async () => {
    mountApp();
    artistsError.value = "读取专辑演出者失败：database unavailable";
    await Vue.nextTick();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({ type: "error", key: "library-artists" });
    expect(artistsError.value).toContain("database unavailable");
    activePage.value = "Playlist";
    await Vue.nextTick();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({ type: "error", key: "library-artists" });
    expect(artistsError.value).toContain("database unavailable");
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

  it("keeps the dialog open and notifies the error when deletion did not happen", async () => {
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
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.type).toBe("error");
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
    expect(notifications.items.value[0]).toMatchObject({
      message: "已从曲库移除 1 首，队列同步失败，请查看日志",
      persistent: true,
    });
    expect(removalCalls).toBe(1);
    expect(playlistRefreshCalls).toBe(0);
  });
});

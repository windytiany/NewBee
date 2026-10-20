import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import { createHostRenderer, findNode, getTextContent } from "../../../support/host/renderer";
import type { PlaylistSummary } from "@/features/playlist/types";
import { notifications, notify } from "@/shared/notifications/center";
import { useNotification } from "@/shared/notifications/useNotification";
import { loadLibraryModules } from "../../library/modules";
import { loadPlaylistModules } from "../modules";

type ManagementResult = { status: "success" } | { status: "error"; message: string };
class TestDocument {
  activeElement: HostNode | null = null;
}
class TestShadowRoot extends TestDocument {}

type HostNode = {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
  style: { display: string };
  value: string;
  focusCalls: number;
  open: boolean;
  listeners: Map<string, Array<(event: Event) => void>>;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
  dispatch: (type: string, event?: Partial<Event>) => void;
  focus: () => void;
  select: () => void;
  showModal: () => void;
  close: () => void;
  getRootNode: () => TestDocument;
};

const firstPlaylist: PlaylistSummary = { id: 1, name: "First", trackCount: 2, coverTrackId: 41 };
const secondPlaylist: PlaylistSummary = { id: 2, name: "Second", trackCount: 1, coverTrackId: 51 };
const thirdPlaylist: PlaylistSummary = { id: 3, name: "Third", trackCount: 0, coverTrackId: null };
const playlists = Vue.ref<PlaylistSummary[]>([]);
const selectedPlaylistId = Vue.ref<number | null>(null);
const selectedPlaylist = Vue.computed(
  () => playlists.value.find(({ id }) => id === selectedPlaylistId.value) ?? null,
);
const playlistTracks = Vue.ref<unknown[]>([]);
const pendingPlaylistIds = Vue.ref<number[]>([]);
const activePage = Vue.ref("Playlist");
const playlistButtons = new Map<number, HostNode>();
const mountedApps: Array<{ unmount: () => void }> = [];
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalDocumentConstructor = Object.getOwnPropertyDescriptor(globalThis, "Document");
const originalShadowRootConstructor = Object.getOwnPropertyDescriptor(globalThis, "ShadowRoot");
let documentTarget: TestDocument;
let focusedNode: HostNode | null;
let renameAction: (playlistId: number, name: string) => Promise<ManagementResult>;
let deleteAction: (playlistId: number) => Promise<ManagementResult>;
let queueMutationCalls: string[];

function compileComponent(
  source: string,
  filename: string,
  id: string,
  modules: Record<string, unknown>,
) {
  const output = compileSfc(source, filename, { id });
  return evaluateSource<{ default: Vue.Component }>(output, modules).default;
}

const vueModules = { vue: Vue, "@/shared/notifications/center": { notify } };
const renameDialogComponent = compileComponent(
  await Bun.file(
    new URL(
      "../../../../src/features/playlist/components/dialogs/RenamePlaylistDialog.vue",
      import.meta.url,
    ),
  ).text(),
  "src/features/playlist/components/dialogs/RenamePlaylistDialog.vue",
  "playlist-rename-dialog-test",
  vueModules,
);
const deleteDialogComponent = compileComponent(
  await Bun.file(
    new URL(
      "../../../../src/features/playlist/components/dialogs/DeletePlaylistDialog.vue",
      import.meta.url,
    ),
  ).text(),
  "src/features/playlist/components/dialogs/DeletePlaylistDialog.vue",
  "playlist-delete-dialog-test",
  vueModules,
);

const PlaylistList = Vue.defineComponent({
  props: ["playlists", "selectedPlaylistId", "isLoading", "error", "pendingPlaylistIds"],
  emits: ["select", "create", "rename", "delete"],
  setup(props, { emit, expose }) {
    const fallbackButton = Vue.shallowRef<HostNode | null>(null);
    async function focusPlaylist(playlistId: number) {
      await Vue.nextTick();
      playlistButtons.get(playlistId)?.focus();
    }
    async function focusAfterDeletion(originalIndex: number) {
      await Vue.nextTick();
      const index = Math.min(Math.max(originalIndex, 0), props.playlists.length - 1);
      const playlist = props.playlists[index] as PlaylistSummary | undefined;
      if (playlist) playlistButtons.get(playlist.id)?.focus();
      else fallbackButton.value?.focus();
    }
    expose({ focusPlaylist, focusAfterDeletion });

    return () =>
      Vue.h("section", { "data-test": "playlist-list" }, [
        ...(props.playlists as PlaylistSummary[]).map((playlist) =>
          Vue.h("div", { key: playlist.id }, [
            Vue.h(
              "button",
              {
                ref: (node: unknown) => {
                  if (node && typeof node === "object") {
                    playlistButtons.set(playlist.id, node as HostNode);
                  } else {
                    playlistButtons.delete(playlist.id);
                  }
                },
                "data-test": `playlist-item-${playlist.id}`,
                onClick: () => emit("select", playlist),
              },
              playlist.name,
            ),
            Vue.h(
              "button",
              {
                "data-test": `rename-playlist-${playlist.id}`,
                onClick: () => emit("rename", playlist.id),
              },
              "重命名",
            ),
            Vue.h(
              "button",
              {
                "data-test": `delete-playlist-${playlist.id}`,
                onClick: () => emit("delete", playlist.id),
              },
              "删除歌单",
            ),
          ]),
        ),
        Vue.h(
          "button",
          {
            ref: (node: unknown) => {
              fallbackButton.value = node && typeof node === "object" ? (node as HostNode) : null;
            },
            "data-test": "create-playlist",
          },
          "新建歌单",
        ),
      ]);
  },
});

const PlaylistBrowser = Vue.defineComponent({
  props: ["playlist"],
  setup(props) {
    return () =>
      Vue.h(
        "div",
        {
          "data-test": "right-playlist",
          "data-playlist-id": props.playlist
            ? String((props.playlist as PlaylistSummary).id)
            : "none",
        },
        (props.playlist as PlaylistSummary | null)?.name ?? "未选择歌单",
      );
  },
});
const AppShell = Vue.defineComponent({
  setup(_, { slots }) {
    return () => Vue.h("main", [slots.left?.(), [slots.workspace?.(), slots.playing?.()]]);
  },
});
const passiveComponent = Vue.defineComponent({ setup: () => () => null });
const emptyLibraryPage = () => ({
  artists: Vue.ref([]),
  albums: Vue.ref([]),
  tracks: Vue.ref([]),
  isLoadingArtists: Vue.ref(false),
  isLoadingAlbums: Vue.ref(false),
  isLoadingTracks: Vue.ref(false),
  artistsError: Vue.ref(""),
  albumsError: Vue.ref(""),
  tracksError: Vue.ref(""),
  isTrackActionPending: Vue.ref(false),
  trackActionError: Vue.ref(""),
  trackActionMessage: Vue.ref(""),
  trackActionMessageType: Vue.ref("success"),
  currentTrack: Vue.ref(null),
  activeQueueRowKey: Vue.ref(null),
  playbackStatus: Vue.ref({ isPlaying: false }),
  isPlaybackCommandPending: Vue.ref(false),
  toggleCurrentAlbumPlayback: async () => false,
  selectedGroup: Vue.ref(null),
  selectedAlbum: Vue.ref(null),
  selectArtist: () => {},
  selectAlbum: () => {},
  playTrackFromLibrary: () => {},
  playAlbumFromLibrary: () => {},
  addTracksToNext: () => {},
  addTracksToQueueEnd: () => {},
  addTracksToPlaylist: async () => ({ successfulTrackIds: [], failures: [] }),
  removeTrackFromLibrary: async () => ({ status: "not-deleted", message: "" }),
});
const appModules: Record<string, unknown> = {
  "@/features/shortcuts/useShortcuts": {
    useShortcuts: () => ({ bindings: Vue.ref({}), run: async () => {} }),
  },
  "@/app/usePageFocus": { usePageFocus() {} },
  "@/features/shortcuts/CommandDialog.vue": { __esModule: true, default: passiveComponent },
  ...vueModules,
  "@/shared/notifications/useNotification": { useNotification },
  "@/features/lyrics/download/LyricsDownloadDialog.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/features/loudness/ConfirmationDialog.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/features/metadata/manual/components/TagEditorDialog.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/shared/notifications/NotificationHost.vue": { __esModule: true, default: passiveComponent },
  "@/features/library/monitoring/MonitoringDialog.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/app/pages": { usePersistentActivePage: () => ({ activePage }) },
  "@/features/import/useDropImport": { useDropImport: () => ({ label: Vue.ref("") }) },
  "@/features/library/browser/useBrowser": { useLibraryBrowser: emptyLibraryPage },
  "@/features/playback/session": {
    usePlaybackSession: () => ({ state: { activeQueueRowKey: Vue.ref(null) } }),
  },
  "@/features/playlist/composables/usePage": {
    usePlaylistPage: () => ({
      playlists,
      selectedPlaylistId,
      selectedPlaylist,
      playlistTracks,
      isLoadingPlaylists: Vue.ref(false),
      isLoadingPlaylistTracks: Vue.ref(false),
      pendingPlaylistIds,
      playlistsError: Vue.ref(""),
      playlistTracksError: Vue.ref(""),
      trackMetadataError: Vue.ref(""),
      isPlaylistActionPending: Vue.ref(false),
      playlistActionError: Vue.ref(""),
      coverTrackId: Vue.computed(() => selectedPlaylist.value?.coverTrackId ?? null),
      isCoverPending: Vue.ref(false),
      selectPlaylist: (playlist: PlaylistSummary) => {
        selectedPlaylistId.value = playlist.id;
      },
      renamePlaylist: (playlistId: number, name: string) => renameAction(playlistId, name),
      deletePlaylist: (playlistId: number) => deleteAction(playlistId),
      playTrackFromPlaylist: () => queueMutationCalls.push("play-track"),
      playPlaylistFromPage: () => queueMutationCalls.push("play-playlist"),
      addPlaylistItemsToNext: () => queueMutationCalls.push("add-next"),
      addPlaylistItemsToQueueEnd: () => queueMutationCalls.push("add-end"),
      removePlaylistItems: () => {},
      reorderPlaylistItems: () => {},
      refreshPlaylists: async () => {},
    }),
  },
  "@/features/metadata/releases/components/ReleaseTagDialog.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/features/playback/pages/NowPlayingPage.vue": { __esModule: true, default: passiveComponent },
  "@/features/playback/controls/PlaybackBar.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/features/library/browser/albums/AlbumBrowser.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/features/library/components/dialogs/DeleteTrackDialog.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/features/library/components/dialogs/DeleteAlbumDialog.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/features/artists/navigation/ArtistList.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/features/playlist/creation/CreatePlaylistDialog.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/features/playlist/components/dialogs/DeletePlaylistDialog.vue": {
    __esModule: true,
    default: deleteDialogComponent,
  },
  "@/features/playlist/tracks/PlaylistBrowser.vue": {
    __esModule: true,
    default: PlaylistBrowser,
  },
  "@/features/playlist/list/PlaylistList.vue": {
    __esModule: true,
    default: PlaylistList,
  },
  "@/features/playlist/components/dialogs/RenamePlaylistDialog.vue": {
    __esModule: true,
    default: renameDialogComponent,
  },
  "@/app/shell/AppShell.vue": { __esModule: true, default: AppShell },
  "@/app/shell/TitleBar.vue": { __esModule: true, default: passiveComponent },
  "@/features/inbox/pages/InboxPage.vue": { __esModule: true, default: passiveComponent },
  "@/shared/components/SidePane.vue": {
    __esModule: true,
    default: Vue.defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          Vue.h("aside", slots.default?.()),
    }),
  },
  "@/features/playback/queue/components/QueuePanel.vue": {
    __esModule: true,
    default: passiveComponent,
  },
  "@/features/playback/current/TrackInfoPanel.vue": {
    __esModule: true,
    default: passiveComponent,
  },
};
appModules["@/features/tracks/bridge"] = { useTrackBridge: () => {} };
appModules["@/app/update"] = { useStartupUpdates: () => {} };
await loadLibraryModules(appModules);
await loadPlaylistModules(appModules);
const appComponent = compileComponent(
  await Bun.file(new URL("../../../../src/app/App.vue", import.meta.url)).text(),
  "src/app/App.vue",
  "playlist-management-app-test",
  appModules,
);

function createHostNode(type: string, text = ""): HostNode {
  const node: HostNode = {
    type,
    props: {},
    children: [],
    parent: null,
    text,
    style: { display: "" },
    value: "",
    focusCalls: 0,
    open: false,
    listeners: new Map(),
    addEventListener(eventType, listener) {
      const listeners = node.listeners.get(eventType) ?? [];
      listeners.push(listener);
      node.listeners.set(eventType, listeners);
    },
    removeEventListener(eventType, listener) {
      node.listeners.set(
        eventType,
        (node.listeners.get(eventType) ?? []).filter((entry) => entry !== listener),
      );
    },
    dispatch(eventType, event = {}) {
      for (const listener of node.listeners.get(eventType) ?? []) {
        listener({ target: node, ...event } as Event);
      }
    },
    focus() {
      node.focusCalls += 1;
      focusedNode = node;
      documentTarget.activeElement = node;
    },
    select() {},
    showModal() {
      node.open = true;
    },
    close() {
      node.open = false;
    },
    getRootNode: () => documentTarget,
  };
  return node;
}

function mountApp() {
  const renderer = createHostRenderer(createHostNode, {
    patchProp: (node, key, _previous, next) => {
      node.props[key] = next;
      if (key === "value") node.value = String(next ?? "");
    },
  });
  const root = createHostNode("root");
  const app = renderer.createApp(appComponent);
  app.mount(root);
  mountedApps.push(app);
  return root;
}

function findByTestId(root: HostNode, id: string) {
  return findNode(root, (node) => node.props["data-test"] === id);
}

function findButtonByText(root: HostNode, text: string) {
  return findNode(root, (node) => node.type === "button" && getTextContent(node).trim() === text);
}

function click(node: HostNode | null) {
  if (node?.props.disabled) return;
  const handler = node?.props.onClick;
  if (typeof handler === "function") handler();
}

function setInputValue(node: HostNode, value: string) {
  node.value = value;
  node.dispatch("input");
  const handler = node.props.onInput;
  if (typeof handler === "function") handler({ target: node });
}

function submitRename(root: HostNode) {
  const form = findNode(root, (node) => node.type === "form");
  const handler = form?.props.onSubmit;
  if (typeof handler !== "function") throw new Error("Rename form submit handler is missing.");
  handler({ preventDefault() {} });
}

async function settleApp() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  await Vue.nextTick();
  await Vue.nextTick();
}

function requestRename(root: HostNode, playlistId: number) {
  click(findByTestId(root, `rename-playlist-${playlistId}`));
}

function requestDelete(root: HostNode, playlistId: number) {
  click(findByTestId(root, `delete-playlist-${playlistId}`));
}

beforeEach(() => {
  notifications.clear();
  playlists.value = [firstPlaylist, secondPlaylist, thirdPlaylist];
  selectedPlaylistId.value = firstPlaylist.id;
  playlistTracks.value = [];
  pendingPlaylistIds.value = [];
  activePage.value = "Playlist";
  playlistButtons.clear();
  focusedNode = null;
  queueMutationCalls = [];
  documentTarget = new TestDocument();
  Object.defineProperty(globalThis, "Document", { configurable: true, value: TestDocument });
  Object.defineProperty(globalThis, "ShadowRoot", { configurable: true, value: TestShadowRoot });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentTarget,
  });
  renameAction = async (playlistId, name) => {
    playlists.value = playlists.value.map((playlist) =>
      playlist.id === playlistId ? { ...playlist, name } : playlist,
    );
    return { status: "success" };
  };
  deleteAction = async (playlistId) => {
    playlists.value = playlists.value.filter(({ id }) => id !== playlistId);
    if (selectedPlaylistId.value === playlistId) selectedPlaylistId.value = null;
    return { status: "success" };
  };
});

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  notifications.clear();
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
  if (originalDocumentConstructor) {
    Object.defineProperty(globalThis, "Document", originalDocumentConstructor);
  } else {
    Reflect.deleteProperty(globalThis, "Document");
  }
  if (originalShadowRootConstructor) {
    Object.defineProperty(globalThis, "ShadowRoot", originalShadowRootConstructor);
  } else {
    Reflect.deleteProperty(globalThis, "ShadowRoot");
  }
});

describe("歌单 workspace 管理", () => {
  it("空名称通过 toast 校验，保留输入焦点和 aria-invalid", async () => {
    let renameCalls = 0;
    renameAction = async () => {
      renameCalls++;
      return { status: "success" };
    };
    const root = mountApp();
    requestRename(root, secondPlaylist.id);
    await settleApp();
    const input = findNode(root, (node) => node.props.id === "rename-playlist-name");
    if (!input) throw new Error("Rename dialog input was not rendered.");
    setInputValue(input, "  ");
    submitRename(root);
    await settleApp();
    expect(renameCalls).toBe(0);
    expect(input.props["aria-invalid"]).toBe("true");
    expect(focusedNode).toBe(input);
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "warning",
      message: "请输入歌单名称",
    });
    expect(findNode(root, (node) => node.props.role === "alert")).toBeNull();
    expect(input.props["aria-invalid"]).toBe("true");
    submitRename(root);
    await settleApp();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "warning",
      message: "请输入歌单名称",
    });
    expect(findNode(root, (node) => node.props.role === "alert")).toBeNull();
    setInputValue(input, "Valid name");
    await Vue.nextTick();
    expect(input.props["aria-invalid"]).toBeUndefined();
  });

  it("重命名失败时保留输入和对话框", async () => {
    renameAction = async () => ({ status: "error", message: "数据库不可用" });
    const root = mountApp();
    requestRename(root, secondPlaylist.id);
    await settleApp();

    const input = findNode(root, (node) => node.props.id === "rename-playlist-name");
    if (!input) throw new Error("Rename dialog input was not rendered.");
    setInputValue(input, "My edited name");
    submitRename(root);
    await settleApp();

    expect(input.value).toBe("My edited name");
    expect(findNode(root, (node) => node.props.role === "alert")).toBeNull();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "重命名歌单失败，请查看日志",
    });
    expect(findNode(root, (node) => node.type === "dialog" && node.open)).not.toBeNull();
    expect(selectedPlaylistId.value).toBe(firstPlaylist.id);
    expect(findByTestId(root, "right-playlist")?.props["data-playlist-id"]).toBe("1");
    expect(queueMutationCalls).toEqual([]);
  });

  it("重命名成功保持当前选择并将 DOM 焦点还给目标行", async () => {
    const root = mountApp();
    requestRename(root, secondPlaylist.id);
    await settleApp();

    const input = findNode(root, (node) => node.props.id === "rename-playlist-name");
    if (!input) throw new Error("Rename dialog input was not rendered.");
    setInputValue(input, "  Updated second  ");
    submitRename(root);
    await settleApp();

    expect(playlists.value.find(({ id }) => id === secondPlaylist.id)?.name).toBe("Updated second");
    expect(selectedPlaylistId.value).toBe(firstPlaylist.id);
    expect(findByTestId(root, "right-playlist")?.props["data-playlist-id"]).toBe("1");
    expect(findByTestId(root, "rename-playlist-name")).toBeNull();
    expect(focusedNode?.props["data-test"]).toBe("playlist-item-2");
    expect(queueMutationCalls).toEqual([]);
  });

  it("取消管理操作后将 DOM 焦点还给原歌单且不改变当前选择", async () => {
    const root = mountApp();
    requestRename(root, secondPlaylist.id);
    await settleApp();
    const cancelButton = findButtonByText(root, "取消");
    if (!cancelButton) throw new Error("Rename dialog cancel button was not rendered.");
    if (typeof cancelButton.props.onClick !== "function") {
      throw new Error(`Rename cancel props: ${Object.keys(cancelButton.props).join(", ")}`);
    }
    click(cancelButton);
    await settleApp();

    expect(findNode(root, (node) => node.type === "dialog" && node.open)).toBeNull();
    expect(focusedNode?.props["data-test"]).toBe("playlist-item-2");
    expect(selectedPlaylistId.value).toBe(firstPlaylist.id);
    expect(findByTestId(root, "right-playlist")?.props["data-playlist-id"]).toBe("1");
  });

  it("删除失败保留歌单和确认说明，仅通知一次", async () => {
    deleteAction = async () => ({ status: "error", message: "数据库不可用" });
    const root = mountApp();
    requestDelete(root, secondPlaylist.id);
    await settleApp();
    click(findButtonByText(root, "确认"));
    await settleApp();
    expect(playlists.value.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(findNode(root, (node) => node.type === "dialog" && node.open)).not.toBeNull();
    expect(findNode(root, (node) => node.props.role === "alert")).toBeNull();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "删除歌单失败，请查看日志",
      count: 1,
    });
  });

  it("删除非当前歌单不改变右侧当前选择", async () => {
    const root = mountApp();
    requestDelete(root, secondPlaylist.id);
    await settleApp();
    click(findButtonByText(root, "确认"));
    await settleApp();

    expect(playlists.value.map(({ id }) => id)).toEqual([firstPlaylist.id, thirdPlaylist.id]);
    expect(selectedPlaylistId.value).toBe(firstPlaylist.id);
    expect(findByTestId(root, "right-playlist")?.props["data-playlist-id"]).toBe("1");
    expect(focusedNode?.props["data-test"]).toBe("playlist-item-3");
    expect(queueMutationCalls).toEqual([]);
  });

  it("删除当前歌单清空选择但不选择相邻歌单，并恢复 DOM 焦点", async () => {
    const root = mountApp();
    requestDelete(root, firstPlaylist.id);
    await settleApp();
    click(findButtonByText(root, "确认"));
    await settleApp();

    expect(playlists.value.map(({ id }) => id)).toEqual([secondPlaylist.id, thirdPlaylist.id]);
    expect(selectedPlaylistId.value).toBeNull();
    expect(findByTestId(root, "right-playlist")?.props["data-playlist-id"]).toBe("none");
    expect(focusedNode?.props["data-test"]).toBe("playlist-item-2");
    expect(queueMutationCalls).toEqual([]);
  });

  it("切页关闭管理对话框但仍通知操作失败", async () => {
    let resolveRename!: (result: ManagementResult) => void;
    renameAction = () =>
      new Promise((resolve) => {
        resolveRename = resolve;
      });
    const root = mountApp();
    requestRename(root, secondPlaylist.id);
    await settleApp();
    const input = findNode(root, (node) => node.props.id === "rename-playlist-name");
    if (!input) throw new Error("Rename dialog was not rendered.");
    setInputValue(input, "Pending rename");
    submitRename(root);
    await Vue.nextTick();
    activePage.value = "Playing";
    await settleApp();
    expect(findNode(root, (node) => node.type === "dialog" && node.open)).toBeNull();
    resolveRename({ status: "error", message: "late failure" });
    await settleApp();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.type).toBe("error");
    activePage.value = "Playlist";
    await settleApp();
    expect(findNode(root, (node) => node.type === "dialog" && node.open)).toBeNull();
    expect(selectedPlaylistId.value).toBe(firstPlaylist.id);
  });

  it("管理目标从歌单目录消失时关闭对话框并恢复相邻行焦点", async () => {
    const root = mountApp();
    requestRename(root, secondPlaylist.id);
    await settleApp();
    playlists.value = playlists.value.filter(({ id }) => id !== secondPlaylist.id);
    await settleApp();
    expect(findNode(root, (node) => node.type === "dialog" && node.open)).toBeNull();
    expect(focusedNode?.props["data-test"]).toBe("playlist-item-3");
    expect(selectedPlaylistId.value).toBe(firstPlaylist.id);
  });

  it("待处理歌单不能打开管理对话框", async () => {
    const root = mountApp();
    pendingPlaylistIds.value = [secondPlaylist.id];
    requestRename(root, secondPlaylist.id);
    await settleApp();
    expect(findNode(root, (node) => node.type === "dialog" && node.open)).toBeNull();
  });

  it("迟到的旧操作错误不会污染新的对话框上下文", async () => {
    let resolveOldRename!: (result: ManagementResult) => void;
    renameAction = () =>
      new Promise((resolve) => {
        resolveOldRename = resolve;
      });
    const root = mountApp();
    requestRename(root, firstPlaylist.id);
    await settleApp();
    const oldInput = findNode(root, (node) => node.props.id === "rename-playlist-name");
    if (!oldInput) throw new Error("First rename dialog was not rendered.");
    setInputValue(oldInput, "Stale result");
    submitRename(root);
    await Vue.nextTick();

    const cancelButton = findButtonByText(root, "取消");
    if (!cancelButton) throw new Error("Rename dialog cancel button was not rendered.");
    if (typeof cancelButton.props.onClick !== "function") {
      throw new Error(`Rename cancel props: ${Object.keys(cancelButton.props).join(", ")}`);
    }
    click(cancelButton);
    await settleApp();
    expect(findNode(root, (node) => node.type === "dialog" && node.open)).toBeNull();
    requestRename(root, secondPlaylist.id);
    await settleApp();
    resolveOldRename({ status: "error", message: "stale failure" });
    await settleApp();

    const currentInput = findNode(root, (node) => node.props.id === "rename-playlist-name");
    expect(currentInput?.value).toBe("Second");
    expect(findNode(root, (node) => node.props.role === "alert")).toBeNull();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.type).toBe("error");
    expect(selectedPlaylistId.value).toBe(firstPlaylist.id);
    expect(queueMutationCalls).toEqual([]);
  });
});

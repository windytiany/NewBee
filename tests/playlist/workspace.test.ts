// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { Playlist } from "@/types/playlist";
import { notifications, notify } from "@/notification/center";
import { useNotification } from "@/notification/useNotification";
import { loadWorkspaceModules } from "../support/workspaceModules";

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

const firstPlaylist: Playlist = { id: 1, name: "First", trackCount: 2, coverTrackId: 41 };
const secondPlaylist: Playlist = { id: 2, name: "Second", trackCount: 1, coverTrackId: 51 };
const thirdPlaylist: Playlist = { id: 3, name: "Third", trackCount: 0, coverTrackId: null };
const playlists = Vue.ref<Playlist[]>([]);
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
  const { descriptor } = parse(source, { filename });
  const compiled = compileScript(descriptor, { id, inlineTemplate: true });
  const output = transpileModule(compiled.content, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", output)(
    (name: string) => modules[name],
    module,
    module.exports,
  );
  return module.exports.default as Vue.Component;
}

const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const vueModules = { vue: Vue, "@/notification/center": { notify } };
const renameDialogComponent = compileComponent(
  await bunRuntime.Bun.file(
    new URL("../../src/playlist/ui/RenamePlaylistDialog.vue", import.meta.url),
  ).text(),
  "src/playlist/ui/RenamePlaylistDialog.vue",
  "playlist-rename-dialog-test",
  vueModules,
);
const deleteDialogComponent = compileComponent(
  await bunRuntime.Bun.file(
    new URL("../../src/playlist/ui/DeletePlaylistDialog.vue", import.meta.url),
  ).text(),
  "src/playlist/ui/DeletePlaylistDialog.vue",
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
      const playlist = props.playlists[index] as Playlist | undefined;
      if (playlist) playlistButtons.get(playlist.id)?.focus();
      else fallbackButton.value?.focus();
    }
    expose({ focusPlaylist, focusAfterDeletion });

    return () =>
      Vue.h("section", { "data-test": "playlist-list" }, [
        ...(props.playlists as Playlist[]).map((playlist) =>
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
          "data-playlist-id": props.playlist ? String((props.playlist as Playlist).id) : "none",
        },
        (props.playlist as Playlist | null)?.name ?? "未选择歌单",
      );
  },
});
const WorkspaceLayout = Vue.defineComponent({
  setup(_, { slots }) {
    return () => Vue.h("main", [slots.left?.(), slots.center?.()]);
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
  ...vueModules,
  "@/notification/useNotification": { useNotification },
  "@/notification/ui/NotificationHost.vue": { __esModule: true, default: passiveComponent },
  "@/navigation/activePage": { usePersistentActivePage: () => ({ activePage }) },
  "@/library/usePage": { useLibraryPage: emptyLibraryPage },
  "@/playback/session": {
    usePlaybackSession: () => ({ state: { activeQueueRowKey: Vue.ref(null) } }),
  },
  "@/playlist/usePage": {
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
      isPlaylistActionPending: Vue.ref(false),
      playlistActionError: Vue.ref(""),
      coverTrackId: Vue.computed(() => selectedPlaylist.value?.coverTrackId ?? null),
      isCoverPending: Vue.ref(false),
      selectPlaylist: (playlist: Playlist) => {
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
  "@/playing/PlayingPage.vue": { __esModule: true, default: passiveComponent },
  "@/playback/ui/PlaybackBar.vue": { __esModule: true, default: passiveComponent },
  "@/library/ui/AlbumBrowser.vue": { __esModule: true, default: passiveComponent },
  "@/library/ui/DeleteTrackDialog.vue": { __esModule: true, default: passiveComponent },
  "@/library/ui/DeleteAlbumDialog.vue": { __esModule: true, default: passiveComponent },
  "@/library/ui/ArtistList.vue": { __esModule: true, default: passiveComponent },
  "@/playlist/ui/CreatePlaylistDialog.vue": { __esModule: true, default: passiveComponent },
  "@/playlist/ui/DeletePlaylistDialog.vue": { __esModule: true, default: deleteDialogComponent },
  "@/playlist/ui/PlaylistBrowser.vue": { __esModule: true, default: PlaylistBrowser },
  "@/playlist/ui/PlaylistList.vue": { __esModule: true, default: PlaylistList },
  "@/playlist/ui/RenamePlaylistDialog.vue": { __esModule: true, default: renameDialogComponent },
  "@/layout/WorkspaceLayout.vue": { __esModule: true, default: WorkspaceLayout },
  "@/navigation/TopBar.vue": { __esModule: true, default: passiveComponent },
};
await loadWorkspaceModules(appModules);
const appComponent = compileComponent(
  await bunRuntime.Bun.file(new URL("../../src/App.vue", import.meta.url)).text(),
  "src/App.vue",
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
  const renderer = Vue.createRenderer<HostNode, HostNode>({
    patchProp: (node, key, _previous, next) => {
      node.props[key] = next;
      if (key === "value") node.value = String(next ?? "");
    },
    insert: (node, parent, anchor) => {
      if (node.parent) {
        const oldIndex = node.parent.children.indexOf(node);
        if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1);
      }
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(node);
      else parent.children.splice(index, 0, node);
    },
    remove: (node) => {
      if (!node.parent) return;
      const index = node.parent.children.indexOf(node);
      if (index >= 0) node.parent.children.splice(index, 1);
      node.parent = null;
    },
    createElement: (type) => createHostNode(type),
    createText: (text) => createHostNode("#text", text),
    createComment: (text) => createHostNode("#comment", text),
    setText: (node, text) => {
      node.text = text;
    },
    setElementText: (node, text) => {
      node.text = text;
      node.children = [];
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => {
      if (!node.parent) return null;
      return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null;
    },
  });
  const root = createHostNode("root");
  const app = renderer.createApp(appComponent);
  app.mount(root);
  mountedApps.push(app);
  return root;
}

function findNode(root: HostNode, predicate: (node: HostNode) => boolean): HostNode | null {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function findByTestId(root: HostNode, id: string) {
  return findNode(root, (node) => node.props["data-test"] === id);
}

function getTextContent(node: HostNode): string {
  return node.text + node.children.map(getTextContent).join("");
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
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "歌单名称不能为空。",
    });
    expect(findNode(root, (node) => node.props.role === "alert")).toBeNull();
    notifications.dismiss(notifications.items.value[0].id);
    expect(input.props["aria-invalid"]).toBe("true");
    submitRename(root);
    await settleApp();
    expect(notifications.items.value).toHaveLength(1);
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
    expect(notifications.items.value.map(({ message }) => message)).toEqual([
      "重命名歌单失败：数据库不可用",
    ]);
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

  it("删除非当前歌单不改变右侧当前选择", async () => {
    const root = mountApp();
    requestDelete(root, secondPlaylist.id);
    await settleApp();
    click(findButtonByText(root, "确认删除"));
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
    click(findButtonByText(root, "确认删除"));
    await settleApp();

    expect(playlists.value.map(({ id }) => id)).toEqual([secondPlaylist.id, thirdPlaylist.id]);
    expect(selectedPlaylistId.value).toBeNull();
    expect(findByTestId(root, "right-playlist")?.props["data-playlist-id"]).toBe("none");
    expect(focusedNode?.props["data-test"]).toBe("playlist-item-2");
    expect(queueMutationCalls).toEqual([]);
  });

  it("切页关闭管理对话框且忽略迟到的操作结果", async () => {
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
    expect(notifications.items.value).toEqual([]);
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
    expect(notifications.items.value).toEqual([]);
    expect(selectedPlaylistId.value).toBe(firstPlaylist.id);
    expect(queueMutationCalls).toEqual([]);
  });
});

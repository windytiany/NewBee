// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { Playlist } from "@/types/playlist";

type HostNode = {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
  focusCalls: number;
  isConnected: boolean;
  focus: () => void;
  contains: (target: unknown) => boolean;
  getBoundingClientRect: () => DOMRect;
};

const playlists: Playlist[] = [
  { id: 1, name: "Selected", trackCount: 0, coverTrackId: null },
  { id: 2, name: "Target", trackCount: 0, coverTrackId: null },
];
const mountedApps: Array<{ unmount: () => void }> = [];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const pendingPlaylistIds = Vue.ref<number[]>([]);
const selectedPlaylistId = Vue.ref<number | null>(1);
const selectedEvents: Playlist[] = [];
const renameEvents: number[] = [];
const deleteEvents: number[] = [];
let focusedNode: HostNode | null;
let focusItemCalls: string[];

function createComponent(
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

function useTestItemFocusList() {
  return {
    isFocused: () => false,
    isSelected: () => false,
    focusItem(itemKey: string) {
      focusItemCalls.push(itemKey);
    },
    syncVisibleItems: () => {},
  };
}

function useTestContextMenu(elements: {
  menuElement: Vue.Ref<HostNode | null>;
  firstMenuItemElement: Vue.Ref<HostNode | null>;
  fallbackFocusElement: Vue.Ref<HostNode | null>;
}) {
  const request = Vue.shallowRef<{
    x: number;
    y: number;
    trigger: HostNode;
    payload: number;
  } | null>(null);
  const position = Vue.reactive({ x: 0, y: 0 });
  function open(nextRequest: NonNullable<typeof request.value>) {
    request.value = nextRequest;
    position.x = nextRequest.x;
    position.y = nextRequest.y;
    void Vue.nextTick(() => elements.firstMenuItemElement.value?.focus());
  }
  function close(restoreFocus = false) {
    const previousRequest = request.value;
    request.value = null;
    if (restoreFocus) void Vue.nextTick(() => previousRequest?.trigger.focus());
  }
  return { request: Vue.computed(() => request.value), position, open, close };
}

const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const icon = Vue.defineComponent({ setup: () => () => null });
const TrackArtwork = Vue.defineComponent({
  setup(_, { slots }) {
    return () => Vue.h("div", slots.default?.());
  },
});
const playlistItem = createComponent(
  await bunRuntime.Bun.file(
    new URL("../src/playlist/ui/PlaylistListItem.vue", import.meta.url),
  ).text(),
  "src/playlist/ui/PlaylistListItem.vue",
  "playlist-list-item-context-test",
  {
    vue: Vue,
    "@lucide/vue": { DiscAlbum: icon },
    "@/artwork/ui/TrackArtwork.vue": { __esModule: true, default: TrackArtwork },
  },
);
const playlistList = createComponent(
  await bunRuntime.Bun.file(new URL("../src/playlist/ui/PlaylistList.vue", import.meta.url)).text(),
  "src/playlist/ui/PlaylistList.vue",
  "playlist-list-context-test",
  {
    vue: Vue,
    "@/interaction/contextMenu": { useContextMenu: useTestContextMenu },
    "@/interaction/itemFocus": { useItemFocusList: useTestItemFocusList },
    "@/playlist/ui/PlaylistListItem.vue": { __esModule: true, default: playlistItem },
  },
);

function createHostNode(type: string, text = ""): HostNode {
  const node: HostNode = {
    type,
    props: {},
    children: [],
    parent: null,
    text,
    focusCalls: 0,
    isConnected: true,
    focus() {
      node.focusCalls += 1;
      focusedNode = node;
    },
    contains(target) {
      let current = target;
      while (current && typeof current === "object") {
        if (current === node) return true;
        current = (current as HostNode).parent;
      }
      return false;
    },
    getBoundingClientRect: () =>
      ({ left: 20, top: 30, right: 220, bottom: 130, width: 200, height: 100 }) as DOMRect,
  };
  return node;
}

function mountPlaylistList() {
  const renderer = Vue.createRenderer<HostNode, HostNode>({
    patchProp: (node, key, _previous, next) => {
      node.props[key] = next;
    },
    insert: (node, parent, anchor) => {
      if (node.parent) {
        const oldIndex = node.parent.children.indexOf(node);
        if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1);
      }
      node.parent = parent;
      node.isConnected = true;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(node);
      else parent.children.splice(index, 0, node);
    },
    remove: (node) => {
      if (!node.parent) return;
      const index = node.parent.children.indexOf(node);
      if (index >= 0) node.parent.children.splice(index, 1);
      node.parent = null;
      node.isConnected = false;
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
  const app = renderer.createApp({
    setup: () => () =>
      Vue.h(playlistList, {
        playlists,
        selectedPlaylistId: selectedPlaylistId.value,
        isLoading: false,
        error: "",
        pendingPlaylistIds: pendingPlaylistIds.value,
        onSelect: (playlist: Playlist) => {
          selectedEvents.push(playlist);
          selectedPlaylistId.value = playlist.id;
        },
        onRename: (playlistId: number) => renameEvents.push(playlistId),
        onDelete: (playlistId: number) => deleteEvents.push(playlistId),
      }),
  });
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

function findPlaylistButton(root: HostNode, playlistId: number) {
  return findNode(root, (node) => node.props["data-playlist-id"] === playlistId);
}

function findMenuItem(root: HostNode, label: string) {
  return findNode(root, (node) => node.props.role === "menuitem" && node.text.includes(label));
}

function openMenu(button: HostNode, keyboard = false) {
  const handler = keyboard ? button.props.onKeydown : button.props.onContextmenu;
  if (typeof handler !== "function") throw new Error("Playlist context-menu handler is missing.");
  handler({
    key: keyboard ? "F10" : undefined,
    shiftKey: keyboard,
    clientX: 40,
    clientY: 50,
    currentTarget: button,
    preventDefault() {},
    stopPropagation() {},
  });
}

function click(node: HostNode | null) {
  if (node?.props.disabled) return;
  const handler = node?.props.onClick;
  if (typeof handler === "function") handler({ preventDefault() {}, stopPropagation() {} });
}

async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
}

beforeEach(() => {
  pendingPlaylistIds.value = [];
  selectedPlaylistId.value = 1;
  selectedEvents.length = 0;
  renameEvents.length = 0;
  deleteEvents.length = 0;
  focusedNode = null;
  focusItemCalls = [];
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

describe("歌单列表上下文菜单", () => {
  it("右键目标歌单打开菜单而不切换当前歌单", async () => {
    const root = mountPlaylistList();
    const target = findPlaylistButton(root, 2);
    if (!target) throw new Error("Target playlist row was not rendered.");

    openMenu(target);
    await settle();

    expect(findMenuItem(root, "重命名")).not.toBeNull();
    expect(target.props["aria-expanded"]).toBe(true);
    expect(selectedPlaylistId.value).toBe(1);
    expect(selectedEvents).toEqual([]);
    expect(focusItemCalls).toEqual(["2"]);
  });

  it("键盘打开目标歌单菜单而不切换当前歌单", async () => {
    const root = mountPlaylistList();
    const target = findPlaylistButton(root, 2);
    if (!target) throw new Error("Target playlist row was not rendered.");

    openMenu(target, true);
    await settle();

    expect(findMenuItem(root, "删除歌单")).not.toBeNull();
    expect(selectedPlaylistId.value).toBe(1);
    expect(selectedEvents).toEqual([]);
    expect(focusedNode?.props.role).toBe("menuitem");
  });

  it("菜单操作 pending 状态只锁定目标歌单", async () => {
    pendingPlaylistIds.value = [1];
    const root = mountPlaylistList();
    const target = findPlaylistButton(root, 2);
    if (!target) throw new Error("Target playlist row was not rendered.");

    openMenu(target);
    await settle();
    const rename = findMenuItem(root, "重命名");
    if (!rename) throw new Error("Rename menu item was not rendered.");
    expect(rename.props.disabled).toBe(false);
    click(rename);
    expect(renameEvents).toEqual([2]);
    expect(selectedPlaylistId.value).toBe(1);

    pendingPlaylistIds.value = [2];
    await settle();
    openMenu(target);
    await settle();
    const deleteItem = findMenuItem(root, "删除歌单");
    if (!deleteItem) throw new Error("Delete menu item was not rendered.");
    expect(deleteItem.props.disabled).toBe(true);
    click(deleteItem);
    expect(deleteEvents).toEqual([]);
    expect(selectedPlaylistId.value).toBe(1);
  });
});

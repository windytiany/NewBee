import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import * as contextMenuModule from "@/shared/interaction/useContextMenu";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import {
  createHostRenderer,
  findNode,
  insertNode,
  removeNode,
  visit,
} from "../../../support/host/renderer";
import type { PlaylistSummary } from "@/features/playlist/types";

type HostNode = {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
  focusCalls: number;
  isConnected: boolean;
  focus: () => void;
  closest: (selector: string) => HostNode | null;
  querySelectorAll: (selector: string) => HostNode[];
  contains: (target: unknown) => boolean;
  getBoundingClientRect: () => DOMRect;
};

const playlists: PlaylistSummary[] = [
  { id: 1, name: "Selected", trackCount: 0, coverTrackId: null },
  { id: 2, name: "Target", trackCount: 0, coverTrackId: null },
];
const mountedApps: Array<{ unmount: () => void }> = [];
const globalNames = ["document", "window", "innerWidth", "innerHeight"] as const;
const originalGlobals = globalNames.map((name) =>
  Object.getOwnPropertyDescriptor(globalThis, name),
);
const pendingPlaylistIds = Vue.ref<number[]>([]);
const selectedPlaylistId = Vue.ref<number | null>(1);
const selectedEvents: PlaylistSummary[] = [];
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
  const output = compileSfc(source, filename, { id });
  return evaluateSource<{ default: Vue.Component }>(output, modules).default;
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

const icon = Vue.defineComponent({ setup: () => () => null });
const TrackArtwork = Vue.defineComponent({
  setup(_, { slots }) {
    return () => Vue.h("div", slots.default?.());
  },
});
const playlistItem = createComponent(
  await Bun.file(
    new URL("../../../../src/features/playlist/list/PlaylistRow.vue", import.meta.url),
  ).text(),
  "src/features/playlist/list/PlaylistRow.vue",
  "playlist-list-item-context-test",
  {
    vue: Vue,
    "@lucide/vue": { DiscAlbum: icon },
    "@/features/artwork/track/TrackArtwork.vue": { __esModule: true, default: TrackArtwork },
  },
);
const playlistList = createComponent(
  await Bun.file(
    new URL("../../../../src/features/playlist/list/PlaylistList.vue", import.meta.url),
  ).text(),
  "src/features/playlist/list/PlaylistList.vue",
  "playlist-list-context-test",
  {
    vue: Vue,
    "@/shared/interaction/useContextMenu": contextMenuModule,
    "@/shared/interaction/item/useSelection": { useItemSelection: useTestItemFocusList },
    "@/features/playlist/list/PlaylistRow.vue": {
      __esModule: true,
      default: playlistItem,
    },
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
    closest(selector) {
      let current: HostNode | null = node;
      while (current) {
        if (selector === '[role="menu"]' && current.props.role === "menu") return current;
        current = current.parent;
      }
      return null;
    },
    querySelectorAll(selector) {
      const matches: HostNode[] = [];
      visit(node, (candidate) => {
        if (
          selector === '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])' &&
          candidate.props.role === "menuitem" &&
          !candidate.props.disabled &&
          candidate.props["aria-disabled"] !== "true"
        )
          matches.push(candidate);
      });
      return matches;
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
  return Vue.markRaw(node);
}

function mountPlaylistList() {
  const renderer = createHostRenderer(createHostNode, {
    insert: (node, parent, anchor) => {
      insertNode(node, parent, anchor);
      node.isConnected = true;
    },
    remove: (node) => {
      if (!node.parent) return;
      removeNode(node);
      node.isConnected = false;
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
        onSelect: (playlist: PlaylistSummary) => {
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
  for (const [name, value] of Object.entries({
    document: { addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    innerWidth: 1024,
    innerHeight: 768,
  }))
    Object.defineProperty(globalThis, name, { configurable: true, value });
});

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  globalNames.forEach((name, index) => {
    const descriptor = originalGlobals[index];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  });
});

describe("歌单列表上下文菜单", () => {
  it("marks the entire sidebar as the playlist creation drop region", () => {
    const root = mountPlaylistList();
    const region = findNode(root, (node) => node.props["data-local-drop"] === "playlists");
    expect(region?.type).toBe("section");
  });

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

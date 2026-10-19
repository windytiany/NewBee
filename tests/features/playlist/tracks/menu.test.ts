import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import {
  createHostRenderer,
  findNode,
  getTextContent,
  insertNode,
  removeNode,
  visit,
} from "../../../support/host/renderer";
import { createItemSelection } from "@/shared/interaction/item/useSelection";
import * as contextMenuModule from "@/shared/interaction/useContextMenu";
import * as dragReorderModule from "@/features/playlist/ordering/drag";
import type { ItemSelectionModifiers } from "@/shared/interaction/item/useSelection";
import type { PlaylistTrackSummary } from "@/features/playlist/types";

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
  contains: (target: unknown) => boolean;
  getBoundingClientRect: () => DOMRect;
  querySelector: (selector: string) => HostNode | null;
  querySelectorAll: (selector: string) => HostNode[];
};

type ItemFocusManager = ReturnType<typeof createItemSelection>;

const tracks: PlaylistTrackSummary[] = [
  {
    playlistItemId: 101,
    trackId: 1,
    title: "First",
    artist: "Artist",
    album: "Album",
    durationMs: 100,
  },
  {
    playlistItemId: 102,
    trackId: 2,
    title: "Second",
    artist: "Artist",
    album: "Album",
    durationMs: 110,
  },
  {
    playlistItemId: 103,
    trackId: 3,
    title: "Third",
    artist: "Artist",
    album: "Album",
    durationMs: 120,
  },
];
const playlistActionError = Vue.ref("");
const isPlaylistActionPending = Vue.ref(false);
const mountedApps: Array<{ unmount: () => void }> = [];
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalInnerWidth = Object.getOwnPropertyDescriptor(globalThis, "innerWidth");
const originalInnerHeight = Object.getOwnPropertyDescriptor(globalThis, "innerHeight");
let itemSelection: ItemFocusManager;
let documentListeners: Map<string, EventListener[]>;
let addToNextCalls: number[][];
let addToQueueEndCalls: number[][];
let focusedNode: HostNode | null;

function createDocumentTarget() {
  documentListeners = new Map();
  return {
    addEventListener(type: string, listener: EventListener) {
      const listeners = documentListeners.get(type) ?? [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type: string, listener: EventListener) {
      documentListeners.set(
        type,
        (documentListeners.get(type) ?? []).filter((entry) => entry !== listener),
      );
    },
    dispatch(type: string, event: Event) {
      for (const listener of documentListeners.get(type) ?? []) listener(event);
    },
  };
}

function useTestItemFocusList(scope: string | Vue.Ref<string>) {
  const currentScope = Vue.computed(() => Vue.toValue(scope));
  const documentTarget = globalThis.document as unknown as ReturnType<typeof createDocumentTarget>;
  itemSelection.connectDocument(documentTarget);
  itemSelection.registerList(currentScope.value);
  const stopScopeWatch = Vue.watch(currentScope, (next, previous) => {
    itemSelection.unregisterList(previous);
    itemSelection.registerList(next);
  });
  Vue.onUnmounted(() => {
    stopScopeWatch();
    itemSelection.unregisterList(currentScope.value);
  });

  return {
    isFocused: (itemKey: string) => itemSelection.isFocused(currentScope.value, itemKey),
    isSelected: (itemKey: string) => itemSelection.isSelected(currentScope.value, itemKey),
    focusItem: (itemKey: string) => itemSelection.focusItem(currentScope.value, itemKey),
    selectItem: (
      itemKey: string,
      visibleKeys: readonly string[],
      modifiers: ItemSelectionModifiers,
    ) => itemSelection.selectItem(currentScope.value, itemKey, visibleKeys, modifiers),
    contextMenuTargets: (itemKey: string, visibleKeys: readonly string[]) =>
      itemSelection.contextMenuTargets(currentScope.value, itemKey, visibleKeys),
    syncVisibleItems: (visibleKeys: readonly string[]) =>
      itemSelection.syncVisibleItems(currentScope.value, visibleKeys),
  };
}

function createComponent(source: string) {
  const output = compileSfc(source, "src/features/playlist/tracks/PlaylistBrowser.vue", {
    id: "playlist-browser-test",
  });
  const icon = Vue.defineComponent({ setup: () => () => null });
  const PlaylistTrack = Vue.defineComponent({
    props: ["track"],
    emits: ["select", "play", "context-menu", "reorder-pointer-down"],
    setup(props, { emit }) {
      return () =>
        Vue.h("li", { "data-playlist-item-id": String(props.track.playlistItemId) }, [
          Vue.h(
            "button",
            {
              "data-item-interaction": "",
              "data-playlist-track-select": "",
              type: "button",
              onClick: (event: MouseEvent) =>
                emit("select", { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey }),
              onContextmenu: (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                emit("context-menu", {
                  playlistItemId: props.track.playlistItemId,
                  x: event.clientX,
                  y: event.clientY,
                  trigger: event.currentTarget,
                });
              },
              onKeydown: (event: KeyboardEvent) => {
                if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
                event.preventDefault();
                event.stopPropagation();
                emit("context-menu", {
                  playlistItemId: props.track.playlistItemId,
                  x: 0,
                  y: 0,
                  trigger: event.currentTarget,
                });
              },
            },
            props.track.title,
          ),
        ]);
    },
  });
  const TrackArtwork = Vue.defineComponent({
    setup(_, { slots }) {
      return () => Vue.h("div", slots.default?.());
    },
  });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/features/metadata/releases/components/ReleaseMenuItem.vue": Vue.defineComponent({
      props: ["trackIds"],
      setup: (props) => () =>
        Vue.h(
          "button",
          { "data-release-targets": JSON.stringify(props.trackIds), role: "menuitem" },
          "根据专辑更新标签",
        ),
    }),
    "@/features/playlist/tracks/AppendMenuItem.vue": Vue.defineComponent({
      props: ["trackIds"],
      setup: (props) => () =>
        Vue.h(
          "button",
          { "data-append-targets": JSON.stringify(props.trackIds), role: "menuitem" },
          "添加到播放列表",
        ),
    }),
    "@/features/library/import/ImportMenuItem.vue": Vue.defineComponent({
      setup: () => () => null,
    }),
    "@/features/playlist/creation/CreatePlaylistDialog.vue": Vue.defineComponent({
      setup: () => () => null,
    }),
    "@lucide/vue": { ChevronRight: icon, DiscAlbum: icon, Play: icon, X: icon },
    "@/features/lyrics/download/DownloadMenuItem.vue": Vue.defineComponent({
      setup: () => () => null,
    }),
    "@/features/loudness/RestoreMenuItem.vue": Vue.defineComponent({
      props: ["trackIds"],
      setup: (props) => () =>
        Vue.h(
          "button",
          { "data-restoration-targets": JSON.stringify(props.trackIds) },
          "恢复原始响度",
        ),
    }),
    "@/features/loudness/AnalysisMenuItem.vue": Vue.defineComponent({
      props: ["trackIds"],
      setup: (props) => () =>
        Vue.h("button", { "data-loudness-targets": JSON.stringify(props.trackIds) }, "分析响度"),
    }),
    "@/features/tracks/presentation/RereadMenuItem.vue": Vue.defineComponent({
      props: ["trackIds"],
      setup: (props) => () =>
        Vue.h("button", { "data-reread-targets": JSON.stringify(props.trackIds) }, "重新读取标签"),
    }),
    "@/features/metadata/manual/components/EditMenuItem.vue": Vue.defineComponent({
      props: ["trackIds"],
      setup: (props) => () =>
        Vue.h("button", { "data-edit-targets": JSON.stringify(props.trackIds) }, "编辑"),
    }),
    "@/features/playback/queue/components/SkipMenuItem.vue": Vue.defineComponent({
      props: ["trackIds"],
      setup: (props) => () =>
        Vue.h("button", { "data-skip-targets": JSON.stringify(props.trackIds) }, "跳过"),
    }),
    "@/shared/interaction/useContextMenu": contextMenuModule,
    "@/shared/interaction/item/useSelection": { useItemSelection: useTestItemFocusList },
    "@/features/playlist/ordering/drag": dragReorderModule,
    "@/features/playlist/tracks/PlaylistTrack.vue": {
      __esModule: true,
      default: PlaylistTrack,
    },
    "@/features/artwork/components/TrackArtwork.vue": { __esModule: true, default: TrackArtwork },
  };
  return evaluateSource<{ default: Vue.Component }>(output, modules).default;
}

const playlistBrowser = createComponent(
  await Bun.file(
    new URL("../../../../src/features/playlist/tracks/PlaylistBrowser.vue", import.meta.url),
  ).text(),
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
    focus: () => {
      node.focusCalls += 1;
      focusedNode = node;
    },
    closest(selector) {
      let current: HostNode | null = node;
      while (current) {
        if (selector === '[role="menu"]' && current.props.role === "menu") return current;
        if (
          selector === "[data-item-interaction]" &&
          Object.prototype.hasOwnProperty.call(current.props, "data-item-interaction")
        ) {
          return current;
        }
        current = current.parent;
      }
      return null;
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
      ({ left: 10, top: 10, right: 250, bottom: 250, width: 240, height: 240 }) as DOMRect,
    querySelector(selector) {
      return findNode(
        node,
        (candidate) =>
          selector === "button[data-playlist-track-select]" &&
          Object.prototype.hasOwnProperty.call(candidate.props, "data-playlist-track-select"),
      );
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
        if (
          selector === "[data-playlist-item-id]" &&
          Object.prototype.hasOwnProperty.call(candidate.props, "data-playlist-item-id")
        ) {
          matches.push(candidate);
        }
      });
      return matches;
    },
  };
  return Vue.markRaw(node);
}

function mountPlaylistBrowser() {
  const emitted: { addToNext: number[][]; addToQueueEnd: number[][] } = {
    addToNext: addToNextCalls,
    addToQueueEnd: addToQueueEndCalls,
  };
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
      Vue.h(playlistBrowser, {
        playlist: { id: 7, name: "Favorites", trackCount: tracks.length, coverTrackId: 1 },
        coverTrackId: 1,
        isCoverPending: false,
        tracks,
        currentRowKey: null,
        isLoadingPlaylists: false,
        playlistsError: "",
        hasPlaylists: true,
        isLoadingTracks: false,
        tracksError: "",
        isPlaylistActionPending: isPlaylistActionPending.value,
        playlistActionError: playlistActionError.value,
        onDismissPlaylistActionError: () => {
          playlistActionError.value = "";
        },
        onAddPlaylistItemsToNext: (ids: number[]) => emitted.addToNext.push(ids),
        onAddPlaylistItemsToQueueEnd: (ids: number[]) => emitted.addToQueueEnd.push(ids),
      }),
  });
  app.mount(root);
  mountedApps.push(app);
  return root;
}

function findTrackButton(root: HostNode, itemId: number) {
  return findNode(
    root,
    (node) =>
      node.props["data-playlist-track-select"] !== undefined &&
      node.parent?.props["data-playlist-item-id"] === String(itemId),
  );
}

function findMenuItem(root: HostNode, label: string) {
  return findNode(
    root,
    (node) => node.props.role === "menuitem" && getTextContent(node).includes(label),
  );
}

function clickNode(
  node: HostNode,
  modifiers: ItemSelectionModifiers = { ctrlKey: false, shiftKey: false },
) {
  (globalThis.document as unknown as ReturnType<typeof createDocumentTarget>).dispatch("click", {
    target: node,
  } as unknown as Event);
  const handler = node.props.onClick;
  if (typeof handler === "function") {
    handler({ ...modifiers, button: 0, preventDefault() {}, stopPropagation() {} });
  }
}

function openContextMenu(node: HostNode, keyboard = false) {
  const handler = keyboard ? node.props.onKeydown : node.props.onContextmenu;
  if (typeof handler !== "function") throw new Error("Playlist context-menu handler is missing.");
  handler({
    key: keyboard ? "ContextMenu" : undefined,
    shiftKey: false,
    clientX: 20,
    clientY: 30,
    currentTarget: node,
    preventDefault() {},
    stopPropagation() {},
  });
}

async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
  await Vue.nextTick();
}

beforeEach(() => {
  itemSelection = createItemSelection();
  addToNextCalls = [];
  addToQueueEndCalls = [];
  playlistActionError.value = "";
  isPlaylistActionPending.value = false;
  focusedNode = null;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: createDocumentTarget(),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {} },
  });
  Object.defineProperty(globalThis, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(globalThis, "innerHeight", { configurable: true, value: 768 });
});

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  for (const [key, descriptor] of [
    ["document", originalDocument],
    ["window", originalWindow],
    ["innerWidth", originalInnerWidth],
    ["innerHeight", originalInnerHeight],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe("歌单曲目上下文菜单", () => {
  it("操作错误由全局通知展示，页面不再渲染提示", async () => {
    playlistActionError.value = "保存歌单排序失败：database unavailable";
    isPlaylistActionPending.value = true;
    const root = mountPlaylistBrowser();
    await settle();

    expect(findNode(root, (node) => node.props.role === "alert")).toBeNull();
    expect(getTextContent(root)).not.toContain("database unavailable");
    expect(getTextContent(root)).not.toContain("正在处理歌单操作");
    expect(getTextContent(root)).not.toContain("已保存");

    expect(playlistActionError.value).toBe("保存歌单排序失败：database unavailable");
  });

  it("右键已选中行保留多选目标并按歌单顺序触发操作", async () => {
    const root = mountPlaylistBrowser();
    const first = findTrackButton(root, 101);
    const third = findTrackButton(root, 103);
    if (!first || !third) throw new Error("Playlist rows were not rendered.");

    clickNode(first);
    clickNode(third, { ctrlKey: true, shiftKey: false });
    openContextMenu(third);
    await settle();

    expect(itemSelection.selection.value?.selectedItemKeys).toEqual(["101", "103"]);
    expect(
      findNode(root, (node) => node.props["data-skip-targets"] !== undefined)?.props[
        "data-skip-targets"
      ],
    ).toBe("[1,3]");
    expect(
      findNode(root, (node) => node.props["data-edit-targets"] !== undefined)?.props[
        "data-edit-targets"
      ],
    ).toBe("[1,3]");
    const update = findMenuItem(root, "根据曲目更新标签");
    if (!update) throw new Error("Missing tag update submenu");
    await (update.props.onMouseenter as () => Promise<void>)();
    await settle();
    expect(
      findNode(root, (node) => node.props["data-reread-targets"] !== undefined)?.props[
        "data-reread-targets"
      ],
    ).toBe("[1,3]");
    expect(
      findNode(root, (node) => node.props["data-loudness-targets"] !== undefined)?.props[
        "data-loudness-targets"
      ],
    ).toBe("[1,3]");
    expect(
      findNode(root, (node) => node.props["data-restoration-targets"] !== undefined)?.props[
        "data-restoration-targets"
      ],
    ).toBe("[1,3]");
    const addButton = findMenuItem(root, "添加为下一首");
    if (!addButton) throw new Error("Queue action was not rendered.");
    clickNode(addButton);
    await settle();

    expect(addToNextCalls).toEqual([[101, 103]]);
    expect(focusedNode).toBe(third);
  });

  it("queues selected rows in their sorted visible order", async () => {
    const root = mountPlaylistBrowser();
    const first = findTrackButton(root, 101);
    const third = findTrackButton(root, 103);
    const sort = findNode(root, (node) => node.props["data-table-sort"] === "number");
    if (!first || !third || !sort) throw new Error("Missing table controls");
    clickNode(first);
    clickNode(third, { ctrlKey: true, shiftKey: false });
    clickNode(sort);
    clickNode(sort);
    await settle();
    openContextMenu(third);
    await settle();
    const next = findMenuItem(root, "添加为下一首");
    if (!next) throw new Error("Missing queue action");
    clickNode(next);
    await settle();
    expect(addToNextCalls).toEqual([[103, 101]]);
    openContextMenu(third);
    await settle();
    const end = findMenuItem(root, "添加到队尾");
    if (!end) throw new Error("Missing queue action");
    clickNode(end);
    await settle();
    expect(addToQueueEndCalls).toEqual([[103, 101]]);
  });

  it("右键未选中行只对目标行操作", async () => {
    const root = mountPlaylistBrowser();
    const first = findTrackButton(root, 101);
    const second = findTrackButton(root, 102);
    if (!first || !second) throw new Error("Playlist rows were not rendered.");

    clickNode(first);
    openContextMenu(second);
    await settle();
    expect(itemSelection.selection.value?.selectedItemKeys).toEqual(["102"]);

    const addButton = findMenuItem(root, "添加到队尾");
    if (!addButton) throw new Error("Queue action was not rendered.");
    clickNode(addButton);
    await settle();
    expect(addToQueueEndCalls).toEqual([[102]]);
  });

  it("菜单全禁用时聚焦容器并更新右键曲目的逻辑焦点", async () => {
    const root = mountPlaylistBrowser();
    const first = findTrackButton(root, 101);
    const second = findTrackButton(root, 102);
    if (!first || !second) throw new Error("Playlist rows were not rendered.");
    clickNode(first);
    isPlaylistActionPending.value = true;
    await settle();

    openContextMenu(second);
    await settle();

    const menu = findNode(root, (node) => node.props.role === "menu");
    if (!menu) throw new Error("Playlist menu was not rendered.");
    const items: HostNode[] = [];
    visit(menu, (node) => {
      if (node.props.role === "menuitem") items.push(node);
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((node) => node.props.disabled === true)).toBe(true);
    expect(focusedNode).toBe(menu);
    expect(itemSelection.focusedItem.value?.itemKey).toBe("102");
    expect(itemSelection.selection.value?.selectedItemKeys).toEqual(["102"]);

    isPlaylistActionPending.value = false;
    await settle();
    expect(focusedNode).toBe(menu);
    openContextMenu(second);
    await settle();
    expect(focusedNode).toBe(findMenuItem(root, "添加为下一首"));
    expect(itemSelection.focusedItem.value?.itemKey).toBe("102");
  });

  it("键盘打开菜单后按 Escape 关闭并将焦点还给触发行", async () => {
    const root = mountPlaylistBrowser();
    const second = findTrackButton(root, 102);
    if (!second) throw new Error("Playlist row was not rendered.");

    openContextMenu(second, true);
    await settle();
    expect(findMenuItem(root, "添加为下一首")).not.toBeNull();
    expect(focusedNode).toBe(findMenuItem(root, "添加为下一首"));

    (globalThis.document as unknown as ReturnType<typeof createDocumentTarget>).dispatch(
      "keydown",
      { key: "Escape", preventDefault() {} } as unknown as Event,
    );
    await settle();

    expect(findMenuItem(root, "添加为下一首")).toBeNull();
    expect(focusedNode).toBe(second);
  });
});

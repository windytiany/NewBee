import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";

import {
  createHostRenderer,
  findNode,
  getTextContent,
  removeNode,
} from "../../support/hostRenderer";
import { createItemSelection } from "@/shared/interaction/useItemSelection";
import * as contextMenuModule from "@/shared/interaction/useContextMenu";
import type { ItemSelectionModifiers } from "@/shared/interaction/useItemSelection";
import type { TrackSummary } from "@/features/library/types";

type HostNode = {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
  focus: () => void;
  isConnected: boolean;
  closest: (selector: string) => HostNode | null;
  getBoundingClientRect: () => DOMRect;
};

type ItemFocusManager = ReturnType<typeof createItemSelection>;

const tracks: TrackSummary[] = [
  {
    id: 1,
    title: "First",
    artist: "Artist",
    album: "Album",
    durationMs: 100,
    discNumber: null,
    trackNumber: 1,
  },
  {
    id: 2,
    title: "Second",
    artist: "Artist",
    album: "Album",
    durationMs: 110,
    discNumber: null,
    trackNumber: 2,
  },
  {
    id: 3,
    title: "Third",
    artist: "Artist",
    album: "Album",
    durationMs: 120,
    discNumber: null,
    trackNumber: 3,
  },
];
const mountedApps: Array<{ unmount: () => void }> = [];
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalInnerWidth = Object.getOwnPropertyDescriptor(globalThis, "innerWidth");
const originalInnerHeight = Object.getOwnPropertyDescriptor(globalThis, "innerHeight");
let itemSelection: ItemFocusManager;
let documentListeners: Map<string, EventListener[]>;
let addToNextCalls: number[][];
let deleteTrackCalls: number[];
let createPlaylistCalls: number[][];

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
  const output = compileSfc(source, "src/features/library/components/albums/AlbumDetail.vue", {
    id: "album-detail-test",
  });
  const icon = Vue.defineComponent({ setup: () => () => null });
  const AlbumTrack = Vue.defineComponent({
    props: ["track", "isFocused", "isSelected", "isCurrentTrack", "isContextMenuOpen"],
    emits: ["select", "play", "context-menu"],
    setup(props, { emit }) {
      return () =>
        Vue.h(
          "button",
          {
            "data-item-interaction": "",
            "data-track-id": props.track.id,
            type: "button",
            onClick: (event: MouseEvent) =>
              emit("select", { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey }),
            onContextmenu: (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              emit("context-menu", {
                trackId: props.track.id,
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
                trackId: props.track.id,
                x: 0,
                y: 0,
                trigger: event.currentTarget,
              });
            },
          },
          props.track.title,
        );
    },
  });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@lucide/vue": { ChevronRight: icon, Play: icon, Pause: icon, X: icon },
    "@/shared/interaction/useContextMenu": contextMenuModule,
    "@/shared/interaction/useItemSelection": { useItemSelection: useTestItemFocusList },
    "@/features/library/components/albums/AlbumTrack.vue": {
      __esModule: true,
      default: AlbumTrack,
    },
    "@/features/library/composables/useTrackColumns": { useTrackColumns: () => Vue.ref(2) },
    "@/features/lyrics/components/DownloadMenuItem.vue": Vue.defineComponent({
      setup: () => () => null,
    }),
    "@/features/tags/manual/components/EditMenuItem.vue": Vue.defineComponent({
      props: ["trackIds"],
      setup: (props) => () =>
        Vue.h("button", { "data-edit-targets": JSON.stringify(props.trackIds) }, "编辑"),
    }),
    "@/features/playback/queue/components/SkipMenuItem.vue": Vue.defineComponent({
      props: ["trackIds"],
      setup: (props) => () =>
        Vue.h("button", { "data-skip-targets": JSON.stringify(props.trackIds) }, "跳过"),
    }),
  };
  return evaluateSource<{ default: Vue.Component }>(output, modules).default;
}

const albumDetail = createComponent(
  await Bun.file(
    new URL("../../../src/features/library/components/albums/AlbumDetail.vue", import.meta.url),
  ).text(),
);

function createHostNode(type: string, text = ""): HostNode {
  const node: HostNode = {
    type,
    props: {},
    children: [],
    parent: null,
    text,
    focus: () => {},
    isConnected: true,
    closest(selector) {
      let current: HostNode | null = node;
      while (current) {
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
    getBoundingClientRect: () =>
      ({ left: 10, top: 10, right: 250, bottom: 250, width: 240, height: 240 }) as DOMRect,
  };
  return node;
}

function mountAlbumDetail(sourceTracks = tracks) {
  const renderer = createHostRenderer(createHostNode, {
    remove: (node) => {
      if (!node.parent) return;
      removeNode(node);
      node.isConnected = false;
    },
  });
  const root = createHostNode("root");
  const app = renderer.createApp({
    setup: () => () =>
      Vue.h(albumDetail, {
        album: { albumArtist: "Artist", album: "Album", year: 2024 },
        albumArtist: "Artist",
        tracks: sourceTracks,
        currentTrackId: null,
        isPlaying: false,
        playbackCommandPending: false,
        tracksLoading: false,
        tracksError: "",
        playlists: [],
        playlistsLoading: false,
        playlistsError: "",
        trackActionPending: false,
        onAddTracksToNext: (trackIds: number[]) => addToNextCalls.push(trackIds),
        onCreatePlaylistWithTracks: (trackIds: number[]) => createPlaylistCalls.push(trackIds),
        onDeleteTrack: (trackId: number) => deleteTrackCalls.push(trackId),
      }),
  });
  app.mount(root);
  mountedApps.push(app);
  return root;
}

function findTrackButton(root: HostNode, trackId: number) {
  return findNode(root, (node) => node.props["data-track-id"] === trackId);
}

function findMenuItem(root: HostNode, label: string) {
  return findNode(root, (node) => node.type === "button" && getTextContent(node).includes(label));
}

function dispatchCapturedClick(node: HostNode) {
  const event = { target: node } as unknown as Event;
  (globalThis.document as unknown as ReturnType<typeof createDocumentTarget>).dispatch(
    "click",
    event,
  );
}

function clickNode(
  node: HostNode,
  modifiers: ItemSelectionModifiers = { ctrlKey: false, shiftKey: false },
) {
  dispatchCapturedClick(node);
  const handler = node.props.onClick;
  if (typeof handler === "function") {
    handler({ ...modifiers, button: 0, preventDefault() {}, stopPropagation() {} });
  }
}

function openContextMenu(node: HostNode, keyboard = false) {
  const handler = keyboard ? node.props.onKeydown : node.props.onContextmenu;
  if (typeof handler !== "function") throw new Error("Track context-menu handler is missing.");
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
}

beforeEach(() => {
  itemSelection = createItemSelection();
  addToNextCalls = [];
  deleteTrackCalls = [];
  createPlaylistCalls = [];
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

describe("专辑曲目上下文菜单目标", () => {
  it("按碟分组，每碟独立计算双列行数，跨碟仍可连续多选", async () => {
    const root = mountAlbumDetail([
      { ...tracks[0]!, discNumber: 1, trackNumber: 1 },
      { ...tracks[1]!, discNumber: 1, trackNumber: 4 },
      { ...tracks[2]!, discNumber: 2, trackNumber: 1 },
    ]);
    const firstDisc = findNode(root, (node) => node.props["aria-label"] === "第 1 碟");
    const secondDisc = findNode(root, (node) => node.props["aria-label"] === "第 2 碟");
    expect(firstDisc?.type).toBe("ol");
    expect(secondDisc?.type).toBe("ol");
    expect(firstDisc && getTextContent(firstDisc)).toBe("FirstSecond");
    expect(secondDisc && getTextContent(secondDisc)).toBe("Third");
    expect(firstDisc?.props.style).toEqual({ gridTemplateRows: "repeat(1, auto)" });
    expect(secondDisc?.props.style).toEqual({ gridTemplateRows: "repeat(1, auto)" });
    clickNode(findTrackButton(root, 1)!);
    clickNode(findTrackButton(root, 3)!, { ctrlKey: false, shiftKey: true });
    await settle();
    expect(itemSelection.selection.value?.selectedItemKeys).toEqual(["1", "2", "3"]);
  });

  it("缺少碟号的曲目归入第一碟", () => {
    const root = mountAlbumDetail();
    const disc = findNode(root, (node) => node.props["aria-label"] === "第 1 碟");
    expect(disc && getTextContent(disc)).toBe("FirstSecondThird");
  });
  it("标题区显示专辑标题和专辑艺术家（年份）", () => {
    const root = mountAlbumDetail();
    const heading = findNode(root, (node) => node.type === "h2");
    expect(heading && getTextContent(heading)).toBe("Album");
    const metadata = findNode(
      root,
      (node) => node.type === "p" && getTextContent(node).includes("Artist"),
    );
    expect(metadata && getTextContent(metadata).trim()).toBe("Artist (2024)");
  });
  it("右键已选中的曲目保留目标集，菜单按钮点击不清除目标，且多选删除禁用", async () => {
    const root = mountAlbumDetail();
    const first = findTrackButton(root, 1);
    const third = findTrackButton(root, 3);
    if (!first || !third) throw new Error("Track rows were not rendered.");

    clickNode(first);
    clickNode(third, { ctrlKey: true, shiftKey: false });
    openContextMenu(third);
    await settle();

    expect(itemSelection.focusedItem.value?.itemKey).toBe("3");
    expect(itemSelection.selection.value?.selectedItemKeys).toEqual(["1", "3"]);
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
    const deleteButton = findMenuItem(root, "从库中删除");
    expect(deleteButton?.props.disabled).toBe(true);
    if (!deleteButton) throw new Error("Delete menu item was not rendered.");
    clickNode(deleteButton);
    expect(deleteTrackCalls).toEqual([]);

    clickNode(findMenuItem(root, "添加为下一首")!);
    await settle();
    expect(addToNextCalls).toEqual([[1, 3]]);
    expect(itemSelection.selection.value?.selectedItemKeys).toEqual(["1", "3"]);
  });

  it("没有现有歌单时可以为右键多选曲目创建播放列表，保留曲目顺序", async () => {
    const root = mountAlbumDetail();
    clickNode(findTrackButton(root, 1)!);
    clickNode(findTrackButton(root, 3)!, { ctrlKey: true, shiftKey: false });
    openContextMenu(findTrackButton(root, 3)!);
    await settle();
    clickNode(findMenuItem(root, "添加到播放列表")!);
    await settle();
    clickNode(findMenuItem(root, "新建播放列表")!);
    await settle();
    expect(createPlaylistCalls).toEqual([[1, 3]]);
    expect(findMenuItem(root, "新建播放列表")).toBeNull();
  });

  it("键盘右键菜单可以为单首歌曲创建播放列表", async () => {
    const root = mountAlbumDetail();
    openContextMenu(findTrackButton(root, 2)!, true);
    await settle();
    clickNode(findMenuItem(root, "添加到播放列表")!);
    await settle();
    clickNode(findMenuItem(root, "新建播放列表")!);
    expect(createPlaylistCalls).toEqual([[2]]);
  });

  it("未选中行及键盘菜单按目标行更新焦点和选择，单首删除保持可用", async () => {
    const root = mountAlbumDetail();
    const second = findTrackButton(root, 2);
    const third = findTrackButton(root, 3);
    if (!second || !third) throw new Error("Track rows were not rendered.");

    openContextMenu(second);
    await settle();
    expect(itemSelection.focusedItem.value?.itemKey).toBe("2");
    expect(itemSelection.selection.value?.selectedItemKeys).toEqual(["2"]);
    const deleteSecond = findMenuItem(root, "从库中删除");
    expect(deleteSecond?.props.disabled).toBe(false);
    if (!deleteSecond) throw new Error("Delete menu item was not rendered.");
    clickNode(deleteSecond);
    expect(deleteTrackCalls).toEqual([2]);

    openContextMenu(third, true);
    await settle();
    expect(itemSelection.focusedItem.value?.itemKey).toBe("3");
    expect(itemSelection.selection.value?.selectedItemKeys).toEqual(["3"]);
  });
});

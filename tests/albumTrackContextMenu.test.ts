// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as TypeScript from "typescript";
import { createItemFocusManager } from "@/interaction/itemFocus";
import type { ItemSelectionModifiers } from "@/interaction/itemFocus";

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

type ItemFocusManager = ReturnType<typeof createItemFocusManager>;

const tracks = [
  { id: 1, title: "First", album: "Album", durationMs: 100 },
  { id: 2, title: "Second", album: "Album", durationMs: 110 },
  { id: 3, title: "Third", album: "Album", durationMs: 120 },
];
const mountedApps: Array<{ unmount: () => void }> = [];
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalInnerWidth = Object.getOwnPropertyDescriptor(globalThis, "innerWidth");
const originalInnerHeight = Object.getOwnPropertyDescriptor(globalThis, "innerHeight");
let itemFocusManager: ItemFocusManager;
let documentListeners: Map<string, EventListener[]>;
let addToNextCalls: number[][];
let deleteTrackCalls: number[];

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
  itemFocusManager.connectDocument(documentTarget);
  itemFocusManager.registerList(currentScope.value);
  const stopScopeWatch = Vue.watch(currentScope, (next, previous) => {
    itemFocusManager.unregisterList(previous);
    itemFocusManager.registerList(next);
  });
  Vue.onUnmounted(() => {
    stopScopeWatch();
    itemFocusManager.unregisterList(currentScope.value);
  });

  return {
    isFocused: (itemKey: string) => itemFocusManager.isFocused(currentScope.value, itemKey),
    isSelected: (itemKey: string) => itemFocusManager.isSelected(currentScope.value, itemKey),
    focusItem: (itemKey: string) => itemFocusManager.focusItem(currentScope.value, itemKey),
    selectItem: (
      itemKey: string,
      visibleKeys: readonly string[],
      modifiers: ItemSelectionModifiers,
    ) => itemFocusManager.selectItem(currentScope.value, itemKey, visibleKeys, modifiers),
    contextMenuTargets: (itemKey: string, visibleKeys: readonly string[]) =>
      itemFocusManager.contextMenuTargets(currentScope.value, itemKey, visibleKeys),
    syncVisibleItems: (visibleKeys: readonly string[]) =>
      itemFocusManager.syncVisibleItems(currentScope.value, visibleKeys),
  };
}

function createComponent(source: string) {
  const { descriptor } = parse(source, { filename: "src/library/ui/AlbumDetail.vue" });
  const compiled = compileScript(descriptor, { id: "album-detail-test", inlineTemplate: true });
  const output = TypeScript.transpileModule(compiled.content, {
    compilerOptions: {
      module: TypeScript.ModuleKind.CommonJS,
      target: TypeScript.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const icon = Vue.defineComponent({ setup: () => () => null });
  const AlbumTrack = Vue.defineComponent({
    props: ["track", "index", "isFocused", "isSelected", "isCurrentTrack", "isContextMenuOpen"],
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
    "@lucide/vue": { ChevronRight: icon, Play: icon, X: icon },
    "@/interaction/itemFocus": { useItemFocusList: useTestItemFocusList },
    "@/library/ui/AlbumTrack.vue": { __esModule: true, default: AlbumTrack },
  };
  const requireModule = (name: string) => modules[name];
  new Function("require", "module", "exports", output)(requireModule, module, module.exports);
  return module.exports.default as Vue.Component;
}

const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const albumDetail = createComponent(
  await bunRuntime.Bun.file(new URL("../src/library/ui/AlbumDetail.vue", import.meta.url)).text(),
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

function mountAlbumDetail() {
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
      Vue.h(albumDetail, {
        album: { albumArtist: "Artist", album: "Album", year: 2024 },
        tracks,
        currentTrackId: null,
        tracksLoading: false,
        tracksError: "",
        playlists: [],
        playlistsLoading: false,
        playlistsError: "",
        trackActionPending: false,
        onAddTracksToNext: (trackIds: number[]) => addToNextCalls.push(trackIds),
        onDeleteTrack: (trackId: number) => deleteTrackCalls.push(trackId),
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

function getTextContent(node: HostNode): string {
  return node.text + node.children.map(getTextContent).join("");
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
  itemFocusManager = createItemFocusManager();
  addToNextCalls = [];
  deleteTrackCalls = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: createDocumentTarget(),
  });
  Object.defineProperty(globalThis, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(globalThis, "innerHeight", { configurable: true, value: 768 });
});

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  for (const [key, descriptor] of [
    ["document", originalDocument],
    ["innerWidth", originalInnerWidth],
    ["innerHeight", originalInnerHeight],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe("专辑曲目上下文菜单目标", () => {
  it("右键已选中的曲目保留目标集，菜单按钮点击不清除目标，且多选删除禁用", async () => {
    const root = mountAlbumDetail();
    const first = findTrackButton(root, 1);
    const third = findTrackButton(root, 3);
    if (!first || !third) throw new Error("Track rows were not rendered.");

    clickNode(first);
    clickNode(third, { ctrlKey: true, shiftKey: false });
    openContextMenu(third);
    await settle();

    expect(itemFocusManager.focusedItem.value?.itemKey).toBe("3");
    expect(itemFocusManager.selection.value?.selectedItemKeys).toEqual(["1", "3"]);
    const deleteButton = findMenuItem(root, "从库中删除");
    expect(deleteButton?.props.disabled).toBe(true);
    if (!deleteButton) throw new Error("Delete menu item was not rendered.");
    clickNode(deleteButton);
    expect(deleteTrackCalls).toEqual([]);

    clickNode(findMenuItem(root, "添加为下一首")!);
    await settle();
    expect(addToNextCalls).toEqual([[1, 3]]);
    expect(itemFocusManager.selection.value?.selectedItemKeys).toEqual(["1", "3"]);
  });

  it("未选中行及键盘菜单按目标行更新焦点和选择，单首删除保持可用", async () => {
    const root = mountAlbumDetail();
    const second = findTrackButton(root, 2);
    const third = findTrackButton(root, 3);
    if (!second || !third) throw new Error("Track rows were not rendered.");

    openContextMenu(second);
    await settle();
    expect(itemFocusManager.focusedItem.value?.itemKey).toBe("2");
    expect(itemFocusManager.selection.value?.selectedItemKeys).toEqual(["2"]);
    const deleteSecond = findMenuItem(root, "从库中删除");
    expect(deleteSecond?.props.disabled).toBe(false);
    if (!deleteSecond) throw new Error("Delete menu item was not rendered.");
    clickNode(deleteSecond);
    expect(deleteTrackCalls).toEqual([2]);

    openContextMenu(third, true);
    await settle();
    expect(itemFocusManager.focusedItem.value?.itemKey).toBe("3");
    expect(itemFocusManager.selection.value?.selectedItemKeys).toEqual(["3"]);
  });
});

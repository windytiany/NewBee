// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

type HostNode = {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
};

type DragPreview = {
  beforeItemId: number | null;
  movingItemIds: number[];
  clientX: number;
  clientY: number;
};

type DragCallbacks = {
  onDragStart: (details: {
    playlistItemId: number;
    itemIds: number[];
    movingItemIds: number[];
    shouldSelectDraggedItem: boolean;
  }) => void;
  onPreview: (preview: DragPreview) => void;
  onDrop: (orderedPlaylistItemIds: number[]) => void;
};

let dragCallbacks: DragCallbacks | null = null;
const emittedReorders: number[][] = [];
const mountedApps: Array<{ unmount: () => void }> = [];

function createHostNode(type: string, text = ""): HostNode {
  return { type, props: {}, children: [], parent: null, text };
}

function createIcon() {
  return Vue.defineComponent({ setup: () => () => Vue.h("span", { "data-test-icon": "files" }) });
}

function useTestItemFocusList() {
  return {
    isFocused: () => false,
    isSelected: () => false,
    selectItem: () => [],
    getSelectedItemKeys: () => [],
    syncVisibleItems: () => {},
  };
}

function createPlaylistBrowserComponent(source: string) {
  const { descriptor } = parse(source, { filename: "src/playlist/ui/PlaylistBrowser.vue" });
  const compiled = compileScript(descriptor, {
    id: "playlist-drag-preview-test",
    inlineTemplate: true,
  });
  const output = transpileModule(compiled.content, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const icon = createIcon();
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@lucide/vue": { DiscAlbum: icon, Play: icon, Files: icon, X: icon },
    "@/interaction/contextMenu": {
      useContextMenu: () => ({
        request: Vue.ref(null),
        position: Vue.reactive({ x: 0, y: 0 }),
        open: () => {},
        close: () => {},
      }),
    },
    "@/interaction/itemFocus": { useItemFocusList: useTestItemFocusList },
    "@/playlist/dragReorder": {
      createPlaylistDragReorder: (callbacks: DragCallbacks) => {
        dragCallbacks = callbacks;
        return { begin: () => {}, cancel: () => {}, dispose: () => {} };
      },
    },
    "@/playlist/ui/PlaylistTrack.vue": {
      __esModule: true,
      default: Vue.defineComponent({
        props: ["track", "dropPosition"],
        setup(props) {
          return () =>
            Vue.h(
              "li",
              { "data-playlist-item-id": String(props.track.playlistItemId) },
              props.dropPosition
                ? [Vue.h("span", { "data-test-drop-position": props.dropPosition })]
                : [],
            );
        },
      }),
    },
    "@/artwork/ui/TrackArtwork.vue": {
      __esModule: true,
      default: Vue.defineComponent({
        setup:
          (_, { slots }) =>
          () =>
            Vue.h("div", slots.default?.()),
      }),
    },
  };
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
const playlistBrowser = createPlaylistBrowserComponent(
  await bunRuntime.Bun.file(
    new URL("../src/playlist/ui/PlaylistBrowser.vue", import.meta.url),
  ).text(),
);

function visit(node: HostNode, action: (entry: HostNode) => void) {
  action(node);
  for (const child of node.children) visit(child, action);
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

function mountPlaylistBrowser() {
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
    render: () =>
      Vue.h(playlistBrowser, {
        playlist: { id: 7, name: "Favorites", trackCount: 3, coverTrackId: null },
        coverTrackId: null,
        isCoverPending: false,
        tracks: [101, 102, 103].map((id) => ({
          playlistItemId: id,
          trackId: id,
          title: `Track ${id}`,
          artist: "Artist",
          album: "Album",
          durationMs: 1000,
        })),
        currentRowKey: null,
        isLoadingPlaylists: false,
        playlistsError: "",
        hasPlaylists: true,
        isLoadingTracks: false,
        tracksError: "",
        isPlaylistActionPending: false,
        playlistActionError: "",
        onReorderPlaylistItems: (ids: number[]) => emittedReorders.push(ids),
      }),
  });
  app.mount(root);
  mountedApps.push(app);
  return root;
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  dragCallbacks = null;
  emittedReorders.length = 0;
});

describe("歌单拖拽预览", () => {
  it("拖动到首位时保持原顺序，只显示数量和落点线，松手后提交", async () => {
    const root = mountPlaylistBrowser();
    const callbacks = dragCallbacks;
    if (!callbacks) throw new Error("Playlist drag callbacks were not initialized.");

    callbacks.onDragStart({
      playlistItemId: 103,
      itemIds: [101, 102, 103],
      movingItemIds: [102, 103],
      shouldSelectDraggedItem: false,
    });
    callbacks.onPreview({
      beforeItemId: 101,
      movingItemIds: [102, 103],
      clientX: 200,
      clientY: 300,
    });
    await Vue.nextTick();

    const rowIds: string[] = [];
    visit(root, (node) => {
      if (node.type === "li" && typeof node.props["data-playlist-item-id"] === "string") {
        rowIds.push(node.props["data-playlist-item-id"]);
      }
    });
    expect(rowIds).toEqual(["101", "102", "103"]);

    const firstRow = findNode(root, (node) => node.props["data-playlist-item-id"] === "101");
    expect(
      firstRow?.children.some((node) => node.props["data-test-drop-position"] === "before"),
    ).toBe(true);
    const preview = findNode(
      root,
      (node) => node.props["data-playlist-drag-preview"] !== undefined,
    );
    expect(preview).not.toBeNull();
    expect(getTextContent(preview!)).toContain("2");

    callbacks.onDrop([102, 103, 101]);
    await Vue.nextTick();
    expect(emittedReorders).toEqual([[102, 103, 101]]);
    expect(
      findNode(root, (node) => node.props["data-playlist-drag-preview"] !== undefined),
    ).toBeNull();
  });
});

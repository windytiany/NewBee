import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "../support/moduleLoader";
import { createHostRenderer, removeNode } from "../support/hostRenderer";
import * as contextMenuModule from "@/interaction/contextMenu";

type HostNode = {
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
  isConnected: boolean;
  focus: () => void;
  getBoundingClientRect: () => DOMRect;
};
const album = { albumArtist: "Artist", album: "Album" };
const mountedApps: Array<{ unmount: () => void }> = [];
const globalNames = ["document", "window", "innerWidth", "innerHeight"] as const;
const originalGlobals = globalNames.map((name) =>
  Object.getOwnPropertyDescriptor(globalThis, name),
);

const source = await Bun.file(
  new URL("../../src/library/ui/AlbumContextMenu.vue", import.meta.url),
).text();
const output = compileSfc(source, "src/library/ui/AlbumContextMenu.vue", {
  id: "album-menu-test",
});
const modules: Record<string, unknown> = {
  vue: Vue,
  "@lucide/vue": { ChevronRight: Vue.defineComponent({ setup: () => () => null }) },
  "@/interaction/contextMenu": contextMenuModule,
};
const AlbumContextMenu = evaluateModule<{ default: Vue.Component }>(output, modules).default;

function createNode(): HostNode {
  return {
    props: {},
    children: [],
    parent: null,
    text: "",
    isConnected: true,
    focus: () => {},
    getBoundingClientRect: () =>
      ({ left: 10, top: 10, right: 250, bottom: 250, width: 240, height: 240 }) as DOMRect,
  };
}
function findNodes(node: HostNode, predicate: (node: HostNode) => boolean): HostNode[] {
  return [
    ...(predicate(node) ? [node] : []),
    ...node.children.flatMap((child) => findNodes(child, predicate)),
  ];
}

function mountMenu() {
  const root = createNode();
  const props = Vue.reactive({
    scope: "artist",
    albumKeys: [JSON.stringify([album.albumArtist, album.album])],
    pending: false,
    playlists: [{ id: 3, name: "Favorites" }],
    playlistsLoading: false,
    playlistsError: "",
  });
  const calls: { name: string; args: unknown[] }[] = [];
  const menu = Vue.ref<{
    open: (request: { album: typeof album; x: number; y: number; trigger: HostNode }) => void;
  } | null>(null);
  const renderer = createHostRenderer((_type, text = "") => ({ ...createNode(), text }), {
    createComment: () => createNode(),
    remove: (node) => {
      removeNode(node);
      node.isConnected = false;
    },
    setElementText: (node, text) => {
      node.text = text;
    },
  });
  const app = renderer.createApp({
    setup: () => () =>
      Vue.h(AlbumContextMenu, {
        ...props,
        ref: menu,
        onAddToNext: (...args: unknown[]) => calls.push({ name: "next", args }),
        onAddToQueueEnd: (...args: unknown[]) => calls.push({ name: "end", args }),
        onAddToPlaylist: (...args: unknown[]) => calls.push({ name: "playlist", args }),
        onDeleteAlbum: (...args: unknown[]) => calls.push({ name: "delete", args }),
      }),
  });
  app.mount(root);
  mountedApps.push(app);
  async function open() {
    menu.value?.open({ album, x: 10, y: 20, trigger: createNode() });
    await Vue.nextTick();
    await Vue.nextTick();
  }
  function click(label: string) {
    const button = findNodes(
      root,
      (node) =>
        node.props.role === "menuitem" &&
        findNodes(node, (child) => child.text.includes(label)).length > 0,
    )[0];
    expect(button).toBeDefined();
    (button.props.onClick as (event: { stopPropagation: () => void }) => void)({
      stopPropagation: () => {},
    });
  }
  return { root, props, calls, open, click };
}

beforeEach(() => {
  for (const [name, value] of Object.entries({
    document: { addEventListener: () => {}, removeEventListener: () => {} },
    window: { addEventListener: () => {}, removeEventListener: () => {} },
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

describe("album context menu", () => {
  it("emits the right-clicked album for queue and deletion actions", async () => {
    const menu = mountMenu();
    for (const label of ["添加为下一首", "添加到队尾", "从库中删除"]) {
      await menu.open();
      menu.click(label);
      await Vue.nextTick();
      expect(findNodes(menu.root, (node) => node.props.role === "menu")).toHaveLength(0);
    }
    expect(menu.calls).toEqual([
      { name: "next", args: [album] },
      { name: "end", args: [album] },
      { name: "delete", args: [album] },
    ]);
  });

  it("emits the target album and playlist from the submenu", async () => {
    const menu = mountMenu();
    await menu.open();
    menu.click("添加到播放列表");
    await Vue.nextTick();
    menu.click("Favorites");
    expect(menu.calls).toEqual([{ name: "playlist", args: [album, 3] }]);
  });

  it("does not render progress text or an empty state while playlists are loading", async () => {
    const menu = mountMenu();
    menu.props.playlistsLoading = true;
    menu.props.playlists = [];
    await menu.open();
    menu.click("添加到播放列表");
    await Vue.nextTick();
    expect(findNodes(menu.root, (node) => node.text.includes("正在"))).toHaveLength(0);
    expect(findNodes(menu.root, (node) => node.text.includes("暂无可用歌单"))).toHaveLength(0);
    menu.props.playlistsLoading = false;
    await Vue.nextTick();
    expect(findNodes(menu.root, (node) => node.text.includes("暂无可用歌单"))).toHaveLength(1);
  });

  it("blocks actions while pending and closes when the album disappears", async () => {
    const menu = mountMenu();
    await menu.open();
    menu.props.pending = true;
    await Vue.nextTick();
    menu.click("添加为下一首");
    expect(menu.calls).toEqual([]);
    menu.props.albumKeys = [];
    await Vue.nextTick();
    expect(findNodes(menu.root, (node) => node.props.role === "menu")).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../../support/module/loader";

import { createHostRenderer, removeNode } from "../../../../support/host/renderer";
import * as contextMenuModule from "@/shared/interaction/useContextMenu";

type HostNode = {
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
  isConnected: boolean;
  focus: () => void;
  closest: (selector: string) => HostNode | null;
  querySelectorAll: (selector: string) => HostNode[];
  getBoundingClientRect: () => DOMRect;
};
const album = { albumArtist: "Artist", album: "Album" };
const mountedApps: Array<{ unmount: () => void }> = [];
const globalNames = ["document", "window", "innerWidth", "innerHeight"] as const;
const originalGlobals = globalNames.map((name) =>
  Object.getOwnPropertyDescriptor(globalThis, name),
);

const source = await Bun.file(
  new URL(
    "../../../../../src/features/library/browser/albums/AlbumContextMenu.vue",
    import.meta.url,
  ),
).text();
const output = compileSfc(source, "src/features/library/browser/albums/AlbumContextMenu.vue", {
  id: "album-menu-test",
});
const modules: Record<string, unknown> = {
  vue: Vue,
  "@lucide/vue": { ChevronRight: Vue.defineComponent({ setup: () => () => null }) },
  "@/shared/interaction/useContextMenu": contextMenuModule,
  "@/features/metadata/releases/components/ReleaseMenuItem.vue": Vue.defineComponent({
    props: ["album"],
    setup: (props) => () =>
      Vue.h("button", { "data-update-album": JSON.stringify(props.album) }, "根据专辑更新标签"),
  }),
  "@/features/metadata/manual/components/EditMenuItem.vue": Vue.defineComponent({
    props: ["album"],
    setup: (props) => () =>
      Vue.h("button", { "data-edit-album": JSON.stringify(props.album) }, "编辑"),
  }),
};
const AlbumContextMenu = evaluateSource<{ default: Vue.Component }>(output, modules).default;

function createNode(text = ""): HostNode {
  return Vue.markRaw<HostNode>({
    props: {},
    children: [],
    parent: null,
    text,
    isConnected: true,
    focus: () => {},
    closest(selector) {
      if (selector === '[role="menu"]' && this.props.role === "menu") return this;
      return this.parent?.closest(selector) ?? null;
    },
    querySelectorAll(selector) {
      return findNodes(
        this,
        (candidate) =>
          selector === '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])' &&
          candidate.props.role === "menuitem" &&
          !candidate.props.disabled &&
          candidate.props["aria-disabled"] !== "true",
      );
    },
    getBoundingClientRect: () =>
      ({ left: 10, top: 10, right: 250, bottom: 250, width: 240, height: 240 }) as DOMRect,
  });
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
  const renderer = createHostRenderer((_type, text = "") => createNode(text), {
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
        onCreatePlaylistWithAlbum: (...args: unknown[]) => calls.push({ name: "create", args }),
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
  it("matches track menu width, action groups and metadata order", async () => {
    const menu = mountMenu();
    await menu.open();
    const container = findNodes(menu.root, (node) => node.props.id === "album-context-menu")[0];
    expect(container).toBeDefined();
    expect(String(container.props.class).split(/\s+/)).toContain("w-56");
    const text = (node: HostNode): string => node.text + node.children.map(text).join("");
    expect(
      container.children.flatMap((node) => {
        if (node.props.role === "separator") return ["|"];
        const label = text(node).trim();
        return label ? [label] : [];
      }),
    ).toEqual([
      "添加为下一首",
      "添加到队尾",
      "|",
      "添加到播放列表",
      "|",
      "编辑",
      "根据专辑更新标签",
      "|",
      "从库中删除",
    ]);
    expect(findNodes(container, (node) => node.text.includes("更新缺少的歌词"))).toEqual([]);
    for (const key of ["data-edit-album", "data-update-album"]) {
      expect(findNodes(container, (node) => key in node.props)[0]?.props[key]).toBe(
        JSON.stringify(album),
      );
    }
  });
  it("passes the exact right-clicked group to the metadata editor", async () => {
    const menu = mountMenu();
    await menu.open();
    expect(
      findNodes(menu.root, (node) => node.props["data-edit-album"] !== undefined)[0]?.props[
        "data-edit-album"
      ],
    ).toBe(JSON.stringify(album));
  });

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

  it("can create a playlist for the target album without any existing playlists", async () => {
    const menu = mountMenu();
    menu.props.playlists = [];
    await menu.open();
    menu.click("添加到播放列表");
    await Vue.nextTick();
    menu.click("新建播放列表");
    await Vue.nextTick();
    expect(menu.calls).toEqual([{ name: "create", args: [album] }]);
    expect(findNodes(menu.root, (node) => node.props.role === "menu")).toHaveLength(0);
  });

  it("does not render progress text or an empty state while playlists are loading", async () => {
    const menu = mountMenu();
    menu.props.playlistsLoading = true;
    menu.props.playlists = [];
    await menu.open();
    menu.click("添加到播放列表");
    await Vue.nextTick();
    expect(findNodes(menu.root, (node) => node.text.includes("正在"))).toHaveLength(0);
    expect(findNodes(menu.root, (node) => node.text.includes("无歌单"))).toHaveLength(0);
    menu.props.playlistsLoading = false;
    await Vue.nextTick();
    expect(findNodes(menu.root, (node) => node.text.includes("无歌单"))).toHaveLength(1);
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

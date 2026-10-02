import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "../support/moduleLoader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
  visit,
} from "../support/hostRenderer";

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
  const output = compileSfc(source, "src/playlist/ui/PlaylistBrowser.vue", {
    id: "playlist-drag-preview-test",
  });
  const icon = createIcon();
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@lucide/vue": { DiscAlbum: icon, Play: icon, Files: icon, X: icon },
    "@/library/ui/TrackSkipMenuItem.vue": icon,
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
  return evaluateModule<{ default: Vue.Component }>(output, modules).default;
}

const playlistBrowser = createPlaylistBrowserComponent(
  await Bun.file(new URL("../../src/playlist/ui/PlaylistBrowser.vue", import.meta.url)).text(),
);

function mountPlaylistBrowser() {
  const renderer = createHostRenderer(createHostNode);
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

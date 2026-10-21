import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
  visit,
} from "../../../support/host/renderer";

type DragPreview = {
  beforeItemId: number | null;
  movingItemIds: number[];
  clientX: number;
  clientY: number;
};

type DragCallbacks = {
  canStart: () => boolean;
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
let dragCancels = 0;
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
  const output = compileSfc(source, "src/features/playlist/tracks/PlaylistBrowser.vue", {
    id: "playlist-drag-preview-test",
  });
  const icon = createIcon();
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/features/metadata/releases/ReleaseMenuItem.vue": Vue.defineComponent({
      setup: () => () => null,
    }),
    "@/features/playlist/tracks/AppendMenuItem.vue": Vue.defineComponent({
      setup: () => () => null,
    }),
    "@/features/library/import/ImportMenuItem.vue": Vue.defineComponent({
      setup: () => () => null,
    }),
    "@/features/playlist/creation/CreatePlaylistDialog.vue": Vue.defineComponent({
      setup: () => () => null,
    }),
    "@lucide/vue": { DiscAlbum: icon, Play: icon, Files: icon, X: icon },
    "@/features/metadata/manual/EditMenuItem.vue": icon,
    "@/features/tracks/presentation/RereadMenuItem.vue": icon,
    "@/features/metadata/replaygain/AnalysisMenuItem.vue": icon,
    "@/features/metadata/replaygain/RemovalMenuItem.vue": icon,
    "@/features/lyrics/download/DownloadMenuItem.vue": icon,
    "@/features/playback/queue/SkipMenuItem.vue": icon,
    "@/shared/interaction/useContextMenu": {
      useContextMenu: () => ({
        request: Vue.ref(null),
        position: Vue.reactive({ x: 0, y: 0 }),
        open: () => {},
        close: () => {},
      }),
    },
    "@/shared/interaction/item/useSelection": { useItemSelection: useTestItemFocusList },
    "@/features/playlist/ordering/drag": {
      createPlaylistDragReorder: (callbacks: DragCallbacks) => {
        dragCallbacks = callbacks;
        return {
          begin: () => {},
          cancel: () => {
            dragCancels++;
          },
          dispose: () => {},
        };
      },
    },
    "@/features/playlist/tracks/PlaylistTrack.vue": {
      __esModule: true,
      default: Vue.defineComponent({
        props: ["track", "dropPosition", "isDragDisabled", "trackNumber"],
        emits: ["play"],
        setup(props, { emit }) {
          return () =>
            Vue.h(
              "li",
              {
                "data-playlist-item-id": String(props.track.playlistItemId),
                "data-drag-disabled": props.isDragDisabled,
                "data-track-number": props.trackNumber,
              },
              [
                Vue.h("button", {
                  "data-playlist-track-select": "",
                  onDblclick: () => emit("play"),
                }),
                ...(props.dropPosition
                  ? [Vue.h("span", { "data-test-drop-position": props.dropPosition })]
                  : []),
              ],
            );
        },
      }),
    },
    "@/features/artwork/track/TrackArtwork.vue": {
      __esModule: true,
      default: Vue.defineComponent({
        setup:
          (_, { slots }) =>
          () =>
            Vue.h("div", slots.default?.()),
      }),
    },
  };
  return evaluateSource<{ default: Vue.Component }>(output, modules).default;
}

const playlistBrowser = createPlaylistBrowserComponent(
  await Bun.file(
    new URL("../../../../src/features/playlist/tracks/PlaylistBrowser.vue", import.meta.url),
  ).text(),
);

function mountPlaylistBrowser() {
  const playedTracks: Array<{ start: number; order: number[] }> = [];
  const playedPlaylists: number[][] = [];
  const tracks = Vue.reactive(
    [101, 102, 103].map((id) => ({
      playlistItemId: id,
      trackId: id,
      title: `Track ${id}`,
      artist: "Artist",
      album: "Album",
      durationMs: 1000,
    })),
  );
  const renderer = createHostRenderer(createHostNode);
  const root = createHostNode("root");
  const app = renderer.createApp({
    render: () =>
      Vue.h(playlistBrowser, {
        playlist: { id: 7, name: "Favorites", trackCount: 3, coverTrackId: null },
        coverTrackId: null,
        isCoverPending: false,
        tracks,
        currentRowKey: null,
        isLoadingPlaylists: false,
        playlistsError: "",
        hasPlaylists: true,
        isLoadingTracks: false,
        tracksError: "",
        isPlaylistActionPending: false,
        playlistActionError: "",
        onReorderPlaylistItems: (ids: number[]) => emittedReorders.push(ids),
        onPlayTrack: (start: number, order: number[]) => playedTracks.push({ start, order }),
        onPlayPlaylist: (order: number[]) => playedPlaylists.push(order),
      }),
  });
  app.mount(root);
  mountedApps.push(app);
  return { root, tracks, playedTracks, playedPlaylists };
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  dragCallbacks = null;
  emittedReorders.length = 0;
  dragCancels = 0;
});

describe("歌单拖拽预览", () => {
  it("sorts the view in both directions and only permits reordering in original order", async () => {
    const { root, tracks, playedTracks, playedPlaylists } = mountPlaylistBrowser();
    Object.assign(tracks[0]!, { title: "Song 10", album: "C", durationMs: 1000 });
    Object.assign(tracks[1]!, { title: "Song 2", album: "A", durationMs: 90000 });
    Object.assign(tracks[2]!, { title: "Song 1", album: "B", durationMs: 2000 });
    const sortBy = async (key: string) => {
      const button = findNode(root, (node) => node.props["data-table-sort"] === key);
      const click = button?.props.onClick;
      if (typeof click !== "function") throw new Error("Missing sort button");
      click();
      await Vue.nextTick();
    };
    const rows = () => {
      const ids: string[] = [];
      visit(root, (node) => {
        if (node.type === "li") ids.push(String(node.props["data-playlist-item-id"]));
      });
      return ids;
    };
    await sortBy("title");
    expect(rows()).toEqual(["103", "102", "101"]);
    expect(dragCallbacks?.canStart()).toBe(false);
    const first = findNode(root, (node) => node.props["data-playlist-item-id"] === "103");
    expect(first?.props["data-drag-disabled"]).toBe(true);
    expect(first?.props["data-track-number"]).toBe(3);
    const rowButton = first && findNode(first, (node) => node.type === "button");
    const doubleclick = rowButton?.props.onDblclick;
    if (typeof doubleclick !== "function") throw new Error("Missing row playback handler");
    doubleclick();
    expect(playedTracks).toEqual([{ start: 103, order: [103, 102, 101] }]);
    const playButton = findNode(root, (node) => node.props["aria-label"] === "播放歌单");
    const play = playButton?.props.onClick;
    if (typeof play !== "function") throw new Error("Missing playlist playback handler");
    play();
    expect(playedPlaylists).toEqual([[103, 102, 101]]);
    await sortBy("title");
    expect(rows()).toEqual(["101", "102", "103"]);
    await sortBy("album");
    expect(rows()).toEqual(["102", "103", "101"]);
    await sortBy("durationMs");
    expect(rows()).toEqual(["101", "103", "102"]);
    await sortBy("durationMs");
    expect(rows()).toEqual(["102", "103", "101"]);
    await sortBy("number");
    expect(rows()).toEqual(["101", "102", "103"]);
    expect(dragCallbacks?.canStart()).toBe(true);
    await sortBy("number");
    expect(rows()).toEqual(["103", "102", "101"]);
    expect(dragCallbacks?.canStart()).toBe(false);
    expect(tracks.map((track) => track.playlistItemId)).toEqual([101, 102, 103]);
    expect(emittedReorders).toEqual([]);
  });
  it("拖动到首位时保持原顺序，只显示数量和落点线，松手后提交", async () => {
    const { root, tracks } = mountPlaylistBrowser();
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

    Object.assign(tracks[1]!, {
      title: "Confirmed title",
      album: "Confirmed album",
      durationMs: 9000,
    });
    await Vue.nextTick();
    expect(dragCancels).toBe(0);
    expect(findNode(root, (node) => node.props["data-playlist-drag-preview"] !== undefined)).toBe(
      preview,
    );
    expect(
      firstRow?.children.some((node) => node.props["data-test-drop-position"] === "before"),
    ).toBe(true);

    callbacks.onDrop([102, 103, 101]);
    await Vue.nextTick();
    expect(emittedReorders).toEqual([[102, 103, 101]]);
    expect(
      findNode(root, (node) => node.props["data-playlist-drag-preview"] !== undefined),
    ).toBeNull();
  });
});

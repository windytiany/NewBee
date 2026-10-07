import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";
import { createHostNode, createHostRenderer, findNode } from "../../support/hostRenderer";

const source = await Bun.file(
  new URL("../../../src/features/library/components/albums/AlbumBrowser.vue", import.meta.url),
).text();
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const apps: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function mountBrowser() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { innerWidth: 800, addEventListener() {}, removeEventListener() {} },
  });
  let loadTrackIds: (() => Promise<readonly number[]>) | null = null;
  let refreshCount = 0;
  const requests: Array<{ command: string; args: unknown }> = [];
  const placeholder = Vue.defineComponent({ setup: () => () => null });
  const selection = { albumArtist: "Right-clicked artist", album: "Right-clicked album" };
  const targetTrackIds = [3, 1];
  const CreatePlaylistDialog = Vue.defineComponent({
    emits: ["created"],
    setup(_, { emit, expose }) {
      expose({ show: (loader: () => Promise<readonly number[]>) => (loadTrackIds = loader) });
      return () => Vue.h("button", { onClick: () => emit("created", 7) }, "created");
    },
  });
  const { default: AlbumBrowser } = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "src/features/library/components/albums/AlbumBrowser.vue"),
    {
      vue: Vue,
      "@tauri-apps/api/core": {
        invoke: async (command: string, args: unknown) => {
          requests.push({ command, args });
          if (command !== "list_album_tracks") throw new Error(`Unexpected ${command}`);
          return [{ id: 5 }, { id: 4 }];
        },
      },
      "@/shared/interaction/useItemSelection": {
        useItemSelection: () => ({ isFocused: () => false, syncVisibleItems() {} }),
      },
      "@/features/artwork/useAlbumArtwork": {
        useAlbumArtwork: () => ({ background: Vue.ref(null), error: Vue.ref("") }),
      },
      "@/features/settings/composables/useAlbumBackground": {
        useAlbumBackground: () => Vue.ref(false),
      },
      "@/features/library/components/albums/AlbumCard.vue": placeholder,
      "@/features/library/components/albums/AlbumDetail.vue": Vue.defineComponent({
        emits: ["create-playlist-with-tracks"],
        setup(_, { emit }) {
          return () =>
            Vue.h("button", {
              "data-action": "tracks",
              onClick: () => emit("create-playlist-with-tracks", targetTrackIds),
            });
        },
      }),
      "@/features/library/components/albums/AlbumContextMenu.vue": Vue.defineComponent({
        emits: ["create-playlist-with-album"],
        setup(_, { emit }) {
          return () =>
            Vue.h("button", {
              "data-action": "album",
              onClick: () => emit("create-playlist-with-album", selection),
            });
        },
      }),
      "@/features/playlist/components/dialogs/CreatePlaylistDialog.vue": CreatePlaylistDialog,
    },
  );
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(AlbumBrowser, {
    artist: { albumArtist: "Expanded artist", albumCount: 1 },
    albums: [{ album: "Expanded album", year: null }],
    selectedAlbum: { albumArtist: "Expanded artist", album: "Expanded album" },
    tracks: [],
    currentTrackId: null,
    albumsLoading: false,
    albumsError: "",
    tracksLoading: false,
    tracksError: "",
    playlists: [],
    playlistsLoading: false,
    playlistsError: "",
    trackActionPending: false,
    onRefreshPlaylists: () => refreshCount++,
  });
  app.mount(root);
  apps.push(app);
  return {
    requests,
    selection,
    targetTrackIds,
    get refreshCount() {
      return refreshCount;
    },
    load: () => {
      if (!loadTrackIds) throw new Error("Creation dialog was not opened");
      return loadTrackIds();
    },
    click: (action: string) => {
      const node = findNode(root, (node) =>
        action === "created" ? node.text === "created" : node.props["data-action"] === action,
      );
      if (!node || typeof node.props.onClick !== "function") throw new Error("Missing action");
      node.props.onClick();
    },
  };
}

it("passes a snapshot of selected songs to the creation dialog and refreshes after saving", async () => {
  const browser = mountBrowser();
  browser.click("tracks");
  browser.targetTrackIds.push(99);
  expect(await browser.load()).toEqual([3, 1]);
  expect(browser.requests).toEqual([]);
  browser.click("created");
  expect(browser.refreshCount).toBe(1);
});

it("loads the right-clicked album, not the expanded album, only when creation is submitted", async () => {
  const browser = mountBrowser();
  browser.click("album");
  expect(browser.requests).toEqual([]);
  browser.selection.album = "Later album";
  expect(await browser.load()).toEqual([5, 4]);
  expect(browser.requests).toEqual([
    {
      command: "list_album_tracks",
      args: { albumArtist: "Right-clicked artist", album: "Right-clicked album" },
    },
  ]);
});

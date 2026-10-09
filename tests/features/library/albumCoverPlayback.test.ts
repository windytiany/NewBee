import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { loadSourceModules } from "../../support/moduleLoader";
import { createHostNode, createHostRenderer, findNode } from "../../support/hostRenderer";
import type { LibraryAlbumSelection } from "@/features/library/types";

const icon = Vue.defineComponent(() => () => null);
const passive = { __esModule: true, default: icon };
const modules: Record<string, unknown> = {
  vue: Vue,
  "@lucide/vue": { DiscAlbum: icon },
  "@/features/artwork/useArtworkSize": { useArtworkSize: () => Vue.ref(160) },
  "@/features/artwork/useAlbumArtwork": {
    useAlbumArtwork: () => ({
      status: Vue.ref("fallback"),
      url: Vue.ref(null),
      error: Vue.ref(""),
      background: Vue.ref(null),
    }),
  },
  "@/features/artwork/background": { ALBUM_BACKGROUND_SAMPLE_SIZE: 32 },
  "@/features/settings/composables/useCoverBackground": {
    useCoverBackground: () => Vue.ref(false),
  },
  "@/shared/interaction/useItemSelection": {
    useItemSelection: () => ({ syncVisibleItems() {}, isFocused: () => false, focusItem() {} }),
  },
  "@/features/library/api": { createLibraryApi: () => ({}) },
  "@/features/library/components/albums/AlbumDetail.vue": passive,
  "@/features/library/components/albums/AlbumContextMenu.vue": passive,
  "@/features/playlist/components/dialogs/CreatePlaylistDialog.vue": passive,
};
await loadSourceModules(
  [
    "features/library/components/albums/AlbumCard.vue",
    "features/library/components/albums/AlbumBrowser.vue",
  ],
  modules,
);
const AlbumBrowser = (
  modules["@/features/library/components/albums/AlbumBrowser.vue"] as { default: Vue.Component }
).default;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const apps: Array<{ unmount: () => void }> = [];

function mountBrowser(selected = false) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { innerWidth: 1024, addEventListener() {}, removeEventListener() {} },
  });
  const selection = { albumArtist: "Artist", album: "Album" };
  const selectedAlbum = Vue.ref<LibraryAlbumSelection | null>(selected ? selection : null);
  const plays: LibraryAlbumSelection[] = [];
  const selections: unknown[] = [];
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(AlbumBrowser, {
        artist: { albumArtist: "Artist", albumCount: 1 },
        albums: [{ album: "Album", year: 2024 }],
        selectedAlbum: selectedAlbum.value,
        tracks: [],
        currentTrackId: null,
        albumsLoading: false,
        albumsError: "",
        tracksLoading: true,
        tracksError: "",
        playlists: [],
        playlistsLoading: false,
        playlistsError: "",
        trackActionPending: false,
        onPlayAlbum: (album: LibraryAlbumSelection) => plays.push(album),
        onSelectAlbum: (album: { album: string | null } | null) => {
          selections.push(album);
          selectedAlbum.value = album ? { ...selection, album: album.album } : null;
        },
      }),
  });
  app.mount(root);
  apps.push(app);
  const cover = findNode(root, (node) => node.type === "span" && !!node.props.onDblclick);
  if (!cover) throw new Error("Missing album cover");
  function dispatch(name: string, detail: number) {
    const handler = cover?.props[name];
    if (typeof handler !== "function") throw new Error(`Missing ${name}`);
    handler({ detail, stopPropagation() {} });
  }
  return { app, plays, selections, selectedAlbum, dispatch };
}

const waitForSingleClick = () => new Promise((resolve) => setTimeout(resolve, 350));

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("library album cover playback", () => {
  for (const selected of [false, true]) {
    it(`plays a ${selected ? "selected" : "collapsed"} album on double click and keeps detail open`, async () => {
      const browser = mountBrowser(selected);
      browser.dispatch("onClick", 1);
      expect(browser.selectedAlbum.value?.album).toBe("Album");
      await Vue.nextTick();
      browser.dispatch("onClick", 2);
      browser.dispatch("onDblclick", 2);
      await waitForSingleClick();
      expect(browser.plays).toEqual([{ albumArtist: "Artist", album: "Album" }]);
      expect(browser.selections).toEqual(selected ? [] : [{ album: "Album", year: 2024 }]);
      expect(browser.selectedAlbum.value?.album).toBe("Album");
    });
  }

  it("toggles detail on two spaced single clicks without playing", async () => {
    const browser = mountBrowser();
    browser.dispatch("onClick", 1);
    expect(browser.selectedAlbum.value?.album).toBe("Album");
    expect(browser.selections).toHaveLength(1);
    await waitForSingleClick();
    browser.dispatch("onClick", 1);
    expect(browser.selectedAlbum.value?.album).toBe("Album");
    expect(browser.selections).toHaveLength(1);
    await waitForSingleClick();
    expect(browser.selectedAlbum.value).toBeNull();
    expect(browser.selections).toHaveLength(2);
    expect(browser.plays).toEqual([]);
  });

  it("cancels a pending close when the cover is removed", async () => {
    const browser = mountBrowser(true);
    browser.dispatch("onClick", 1);
    browser.app.unmount();
    apps.splice(apps.indexOf(browser.app), 1);
    await waitForSingleClick();
    expect(browser.selections).toEqual([]);
    expect(browser.plays).toEqual([]);
  });
});

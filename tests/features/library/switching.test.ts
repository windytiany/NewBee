import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import type { Component } from "vue";
import type { useLibraryBrowser } from "@/features/library/composables/useBrowser";
import type { useAlbumArtwork } from "@/features/artwork/useAlbumArtwork";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import type { AlbumSummary } from "@/features/library/types";
import { compileSfc, evaluateSource, transpileScript } from "../../support/moduleLoader";
import { createHostNode, createHostRenderer, findNode } from "../../support/hostRenderer";

const browserSource = await Bun.file(
  new URL("../../../src/features/library/composables/useBrowser.ts", import.meta.url),
).text();
const albumBrowserSource = await Bun.file(
  new URL("../../../src/features/library/components/albums/AlbumBrowser.vue", import.meta.url),
).text();
const artworkSource = await Bun.file(
  new URL("../../../src/features/artwork/useAlbumArtwork.ts", import.meta.url),
).text();
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const mountedApps: Array<{ unmount: () => void }> = [];

async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Vue.nextTick();
}

function mountBrowser() {
  const window = Object.assign(new EventTarget(), { innerWidth: 800 });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} },
  });
  const artist = { albumArtist: "Artist", albumCount: 1 };
  const album = { album: "Album", year: 2024 };
  const replacement = { album: "New album", year: 2025 };
  let availableAlbums: AlbumSummary[] = [album];
  const requests: string[] = [];
  const lifecycle = { browserMounts: 0, browserUnmounts: 0, cardMounts: 0, cardUnmounts: 0 };
  const covers = { subscriptions: 0, unsubscriptions: 0 };
  const placeholder = Vue.defineComponent({ render: () => null });
  const dependencies: Record<string, unknown> = {
    vue: Vue,
    "@/features/artwork/useArtworkSize": { useArtworkSize: () => Vue.ref(160) },
    "@tauri-apps/api/core": {
      invoke: async (command: string) => {
        requests.push(command);
        switch (command) {
          case "list_album_artists":
            return [artist];
          case "list_albums":
            return availableAlbums;
          case "get_album_artwork":
            return new ArrayBuffer(0);
          default:
            throw new Error(`Unexpected command: ${command}`);
        }
      },
    },
    "@lucide/vue": { DiscAlbum: placeholder },
    "@/features/library/composables/useActions": { useLibraryActions: () => ({}) },
    "@/features/settings/composables/useCoverBackground": {
      useCoverBackground: () => Vue.ref(false),
    },
    "@/features/library/components/albums/AlbumDetail.vue": {
      __esModule: true,
      default: placeholder,
    },
    "@/features/library/components/albums/AlbumContextMenu.vue": {
      __esModule: true,
      default: placeholder,
    },
    "@/features/playlist/components/dialogs/CreatePlaylistDialog.vue": {
      __esModule: true,
      default: placeholder,
    },
  };
  const artwork = evaluateSource<{ useAlbumArtwork: typeof useAlbumArtwork }>(
    transpileScript(artworkSource),
    dependencies,
  );
  const observeArtwork: typeof useAlbumArtwork = (selection, purpose = "cover", size = null) => {
    if (purpose === "cover") {
      covers.subscriptions += 1;
      Vue.onScopeDispose(() => {
        covers.unsubscriptions += 1;
      });
    }
    return artwork.useAlbumArtwork(selection, purpose, size);
  };
  dependencies["@/features/artwork/useAlbumArtwork"] = { useAlbumArtwork: observeArtwork };
  const { useLibraryBrowser: createBrowser } = evaluateSource<{
    useLibraryBrowser: typeof useLibraryBrowser;
  }>(transpileScript(browserSource), dependencies);
  const { default: AlbumBrowser } = evaluateSource<{ default: Component }>(
    compileSfc(albumBrowserSource, "AlbumBrowser.vue"),
    dependencies,
  );
  const active = Vue.ref(true);
  let browser: ReturnType<typeof useLibraryBrowser> | undefined;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup() {
      const page = createBrowser(active);
      browser = page;
      // Like LibraryPage's v-show, visibility changes never remove AlbumBrowser.
      return () =>
        Vue.h("div", { hidden: !active.value }, [
          Vue.h(AlbumBrowser, {
            artist: page.selectedGroup.value,
            albums: page.albums.value,
            selectedAlbum: page.selectedAlbum.value,
            tracks: page.tracks.value,
            currentTrackId: null,
            albumsLoading: page.isLoadingAlbums.value,
            albumsError: page.albumsError.value,
            tracksLoading: page.isLoadingTracks.value,
            tracksError: page.tracksError.value,
            playlists: [],
            playlistsLoading: false,
            playlistsError: "",
            trackActionPending: false,
            onSelectAlbum: page.selectAlbum,
            onVnodeMounted: () => {
              lifecycle.browserMounts += 1;
            },
            onVnodeUnmounted: () => {
              lifecycle.browserUnmounts += 1;
            },
          }),
        ]);
    },
  });
  app.mixin({
    mounted() {
      if (this.$options.__name === "AlbumCard") lifecycle.cardMounts += 1;
    },
    unmounted() {
      if (this.$options.__name === "AlbumCard") lifecycle.cardUnmounts += 1;
    },
  });
  app.mount(root);
  mountedApps.push(app);
  if (!browser) throw new Error("Library browser did not mount.");
  return {
    active,
    browser,
    artist,
    album,
    replacement,
    requests,
    lifecycle,
    covers,
    window,
    root,
    changeLibrary: () => {
      availableAlbums = [replacement];
      window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
    },
  };
}

afterEach(async () => {
  for (const app of mountedApps.splice(0)) app.unmount();
  await Vue.nextTick();
  for (const [key, descriptor] of [
    ["window", originalWindow],
    ["localStorage", originalStorage],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

it("keeps real album cards and cover subscriptions mounted across inactive/active switches", async () => {
  const fixture = mountBrowser();
  await settle();
  fixture.browser.selectArtist(fixture.artist);
  await settle();
  const card = findNode(fixture.root, (node) => node.type === "article");
  expect(card).not.toBeNull();
  expect(fixture.requests).toEqual(["list_album_artists", "list_albums", "get_album_artwork"]);

  for (let index = 0; index < 3; index += 1) {
    fixture.active.value = false;
    await settle();
    expect(findNode(fixture.root, (node) => node.type === "article")).toBe(card);
    fixture.active.value = true;
    await Vue.nextTick();
    expect(findNode(fixture.root, (node) => node.type === "article")).toBe(card);
    await settle();
    expect(findNode(fixture.root, (node) => node.type === "article")).toBe(card);
    expect(fixture.lifecycle).toEqual({
      browserMounts: 1,
      browserUnmounts: 0,
      cardMounts: 1,
      cardUnmounts: 0,
    });
    expect(fixture.covers).toEqual({ subscriptions: 1, unsubscriptions: 0 });
    expect(fixture.requests).toEqual(["list_album_artists", "list_albums", "get_album_artwork"]);
  }
});

it("refreshes the mounted album browser on activation after a library change while hidden", async () => {
  const fixture = mountBrowser();
  await settle();
  fixture.browser.selectArtist(fixture.artist);
  await settle();
  fixture.active.value = false;
  await settle();
  fixture.requests.length = 0;
  fixture.changeLibrary();
  await settle();
  expect(fixture.requests).toEqual([]);
  expect(fixture.browser.albums.value).toEqual([fixture.album]);

  fixture.active.value = true;
  await settle();
  expect(fixture.browser.albums.value).toEqual([fixture.replacement]);
  expect(
    findNode(fixture.root, (node) => node.props["aria-label"] === "查看专辑 New album"),
  ).not.toBeNull();
  expect(
    findNode(fixture.root, (node) => node.props["aria-label"] === "查看专辑 Album"),
  ).toBeNull();
  expect(fixture.requests).toEqual(["list_album_artists", "list_albums", "get_album_artwork"]);
  expect(fixture.lifecycle.browserMounts).toBe(1);
  expect(fixture.lifecycle.browserUnmounts).toBe(0);
});

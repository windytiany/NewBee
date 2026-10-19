import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { loadSourceModules } from "../../../../support/module/loader";
import { createHostNode, createHostRenderer, findNode } from "../../../../support/host/renderer";
import type { LibraryAlbumSelection } from "@/features/library/types";
import type { TrackSummary } from "@/features/tracks/types";

const icon = Vue.defineComponent(() => () => null);
const playbackIcon = (name: string) =>
  Vue.defineComponent(() => () => Vue.h("svg", { "data-icon": name }));
const passive = { __esModule: true, default: icon };
const keyboardEvents: unknown[] = [];
const modules: Record<string, unknown> = {
  "@/shared/interaction/item/keyboard": {
    createItemKeyboard: () => ({
      onKeydown: (event: unknown) => keyboardEvents.push(event),
      onFocusin() {},
    }),
  },
  vue: Vue,
  "@/features/metadata/releases/components/ReleaseMenuItem.vue": passive,
  "@/features/artwork/artist/PhotoEditor.vue": passive,
  "@/features/library/statistics/LibraryStatistics.vue": passive,
  "@lucide/vue": {
    DiscAlbum: icon,
    ChevronRight: icon,
    X: icon,
    Play: playbackIcon("Play"),
    Pause: playbackIcon("Pause"),
  },
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
  "@/shared/interaction/item/useSelection": {
    useItemSelection: () => ({
      syncVisibleItems() {},
      isFocused: () => false,
      isSelected: () => false,
      focusItem() {},
    }),
  },
  "@/features/library/api": { createLibraryApi: () => ({}) },
  "@/shared/interaction/useContextMenu": {
    useContextMenu: () => ({
      request: Vue.ref(null),
      position: Vue.ref({ x: 0, y: 0 }),
      open() {},
      close() {},
    }),
  },
  "@/features/library/browser/albums/useTrackColumns": { useTrackColumns: () => Vue.ref(2) },
  "@/features/library/browser/albums/AlbumTrack.vue": passive,
  "@/features/metadata/manual/components/EditMenuItem.vue": passive,
  "@/features/tracks/presentation/RereadMenuItem.vue": passive,
  "@/features/loudness/AnalysisMenuItem.vue": passive,
  "@/features/loudness/RestoreMenuItem.vue": passive,
  "@/features/lyrics/download/DownloadMenuItem.vue": passive,
  "@/features/playback/queue/components/SkipMenuItem.vue": passive,
  "@/features/library/browser/albums/AlbumContextMenu.vue": passive,
  "@/features/playlist/creation/CreatePlaylistDialog.vue": passive,
};
await loadSourceModules(
  [
    "features/library/browser/albums/AlbumCard.vue",
    "features/library/browser/albums/AlbumDetail.vue",
    "features/library/browser/albums/AlbumBrowser.vue",
  ],
  modules,
);
const AlbumBrowser = (
  modules["@/features/library/browser/albums/AlbumBrowser.vue"] as { default: Vue.Component }
).default;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
const apps: Array<{ unmount: () => void }> = [];

const albumTracks: TrackSummary[] = [
  {
    id: 1,
    title: "First",
    artist: "Artist",
    album: "Album",
    durationMs: 100,
    discNumber: 1,
    trackNumber: 1,
  },
  {
    id: 2,
    title: "Second",
    artist: "Artist",
    album: "Album",
    durationMs: 100,
    discNumber: 1,
    trackNumber: 2,
  },
];
type PlaybackState = {
  tracks: TrackSummary[];
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackCommandPending: boolean;
  tracksLoading: boolean;
  trackActionPending: boolean;
};

function mountBrowser(selected = false, initialState: Partial<PlaybackState> = {}) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { innerWidth: 1024, addEventListener() {}, removeEventListener() {} },
  });
  const selection = { albumArtist: "Artist", album: "Album" };
  const selectedAlbum = Vue.ref<LibraryAlbumSelection | null>(selected ? selection : null);
  const state = Vue.reactive<PlaybackState>({
    tracks: [],
    currentTrackId: null,
    isPlaying: false,
    playbackCommandPending: false,
    tracksLoading: true,
    trackActionPending: false,
    ...initialState,
  });
  const plays: LibraryAlbumSelection[] = [];
  const toggles: unknown[] = [];
  const selections: unknown[] = [];
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(AlbumBrowser, {
        artist: { artist: "Artist", albumCount: 1 },
        grouping: "albumArtist",
        albums: [{ albumArtist: "Artist", album: "Album", year: 2024 }],
        selectedAlbum: selectedAlbum.value,
        ...state,
        albumsLoading: false,
        albumsError: "",
        tracksError: "",
        playlists: [],
        playlistsLoading: false,
        playlistsError: "",
        onTogglePlayback: () => toggles.push("togglePlayback"),
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
  function dispatch(name: string, detail: number, timeStamp = globalThis.performance.now()) {
    const handler = cover?.props[name];
    if (typeof handler !== "function") throw new Error(`Missing ${name}`);
    handler({ detail, timeStamp, stopPropagation() {} });
  }
  function playbackButton() {
    const header = findNode(root, (node) => node.type === "h2")?.parent;
    const button = header && findNode(header, (node) => node.type === "button");
    if (!button) throw new Error("Missing album playback button");
    return button;
  }
  function clickPlayback() {
    const handler = playbackButton().props.onClick;
    if (typeof handler !== "function") throw new Error("Missing playback handler");
    handler();
  }
  return {
    root,
    app,
    plays,
    toggles,
    state,
    selections,
    selectedAlbum,
    dispatch,
    playbackButton,
    clickPlayback,
  };
}

const waitForSingleClick = () => new Promise((resolve) => setTimeout(resolve, 350));

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalElement) Object.defineProperty(globalThis, "Element", originalElement);
  else Reflect.deleteProperty(globalThis, "Element");
  keyboardEvents.length = 0;
});

describe("library album keyboard with expanded detail", () => {
  class AlbumTarget {
    closest(selector: string) {
      return selector === "button[data-album-card]" ? this : null;
    }
  }

  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"]) {
    it(`${key} only transfers album focus to tracks for ArrowDown`, () => {
      Object.defineProperty(globalThis, "Element", { configurable: true, value: AlbumTarget });
      const browser = mountBrowser(true, { tracks: albumTracks, tracksLoading: false });
      const section = findNode(browser.root, (node) => node.type === "section");
      if (!section) throw new Error("Missing browser section");
      let focused = 0;
      let scrolled = 0;
      let prevented = 0;
      let stopped = 0;
      const track = {
        focus: () => focused++,
        scrollIntoView: () => scrolled++,
      };
      Object.assign(section, {
        querySelector: (selector: string) =>
          selector === "button[data-album-track-row]" ? track : null,
      });
      const handler = section.props.onKeydown;
      if (typeof handler !== "function") throw new Error("Missing keyboard handler");
      const event = {
        key,
        target: new AlbumTarget(),
        preventDefault: () => prevented++,
        stopPropagation: () => stopped++,
      };
      handler(event);
      expect(focused).toBe(key === "ArrowDown" ? 1 : 0);
      expect(scrolled).toBe(key === "ArrowDown" ? 1 : 0);
      expect(prevented).toBe(key === "Enter" ? 0 : 1);
      expect(stopped).toBe(key === "Enter" ? 0 : 1);
      expect(keyboardEvents).toEqual(key === "Enter" ? [event] : []);
      expect(browser.selectedAlbum.value?.album).toBe("Album");
    });
  }
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
      expect(browser.toggles).toEqual([]);
      expect(browser.selections).toEqual(
        selected ? [] : [{ albumArtist: "Artist", album: "Album", year: 2024 }],
      );
      expect(browser.selectedAlbum.value?.album).toBe("Album");
    });
  }

  for (const selected of [false, true]) {
    const windowMs = selected ? 150 : 300;
    for (const interval of [windowMs - 50, windowMs]) {
      it(`accepts a double click at ${interval}ms when selected=${selected}`, async () => {
        const browser = mountBrowser(selected);
        browser.dispatch("onClick", 1, 0);
        await Vue.nextTick();
        browser.dispatch("onClick", 2, interval);
        browser.dispatch("onDblclick", 2, interval);
        await waitForSingleClick();
        expect(browser.plays).toEqual([{ albumArtist: "Artist", album: "Album" }]);
        expect(browser.selections).toEqual(
          selected ? [] : [{ albumArtist: "Artist", album: "Album", year: 2024 }],
        );
        expect(browser.selectedAlbum.value?.album).toBe("Album");
      });
    }
  }

  for (const selected of [false, true]) {
    const windowMs = selected ? 150 : 300;
    it(`treats a native double click outside ${windowMs}ms as single clicks when selected=${selected}`, async () => {
      const browser = mountBrowser(selected);
      browser.dispatch("onClick", 1, 0);
      await new Promise((resolve) => setTimeout(resolve, windowMs + 25));
      expect(browser.selectedAlbum.value !== null).toBe(!selected);
      browser.dispatch("onClick", 2, windowMs + 1);
      browser.dispatch("onDblclick", 2, windowMs + 1);
      await waitForSingleClick();
      expect(browser.selectedAlbum.value !== null).toBe(selected);
      expect(browser.selections).toHaveLength(2);
      expect(browser.plays).toEqual([]);
    });
  }

  it("closes expanded detail after 150ms on a single click", async () => {
    const browser = mountBrowser(true);
    browser.dispatch("onClick", 1);
    expect(browser.selectedAlbum.value?.album).toBe("Album");
    await new Promise((resolve) => setTimeout(resolve, 175));
    expect(browser.selectedAlbum.value).toBeNull();
    expect(browser.selections).toEqual([null]);
    expect(browser.plays).toEqual([]);
  });

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

describe("album detail playback button", () => {
  it("keeps the title non-growing while allowing truncation beside the playback button", () => {
    const browser = mountBrowser(true);
    const heading = findNode(browser.root, (node) => node.type === "h2");
    if (!heading) throw new Error("Missing album heading");
    const classes = String(heading.props.class).split(/\s+/);
    expect(classes).not.toContain("flex-1");
    expect(classes).toContain("min-w-0");
    expect(classes).toContain("truncate");
    expect(heading.parent).toBe(browser.playbackButton().parent);
  });

  for (const currentTrackId of [null, 99, 1, 2]) {
    for (const isPlaying of [false, true]) {
      it(`uses album membership for track ${currentTrackId} while playing=${isPlaying}`, () => {
        const browser = mountBrowser(true, {
          tracks: albumTracks,
          tracksLoading: false,
          currentTrackId,
          isPlaying,
        });
        const isCurrentAlbum = currentTrackId === 1 || currentTrackId === 2;
        const label = isCurrentAlbum
          ? isPlaying
            ? "暂停当前曲目"
            : "继续播放当前曲目"
          : "播放专辑";
        const button = browser.playbackButton();
        expect(button.props["aria-label"]).toBe(label);
        expect(button.props.title).toBe(label);
        expect(button.props.disabled).toBe(false);
        expect(findNode(button, (node) => !!node.props["data-icon"])?.props["data-icon"]).toBe(
          isCurrentAlbum && isPlaying ? "Pause" : "Play",
        );
        browser.clickPlayback();
        expect(browser.toggles).toEqual(isCurrentAlbum ? ["togglePlayback"] : []);
        expect(browser.plays).toEqual(
          isCurrentAlbum ? [] : [{ albumArtist: "Artist", album: "Album" }],
        );
      });
    }
  }

  it("updates the same button as playback state, current track and album tracks change", async () => {
    const browser = mountBrowser(true, {
      tracks: albumTracks,
      tracksLoading: false,
      currentTrackId: 1,
      isPlaying: true,
    });
    const button = browser.playbackButton();
    const expectButton = (label: string, icon: string) => {
      expect(browser.playbackButton()).toBe(button);
      expect(button.props["aria-label"]).toBe(label);
      expect(button.props.title).toBe(label);
      expect(findNode(button, (node) => !!node.props["data-icon"])?.props["data-icon"]).toBe(icon);
    };
    expectButton("暂停当前曲目", "Pause");
    browser.state.isPlaying = false;
    await Vue.nextTick();
    expectButton("继续播放当前曲目", "Play");
    browser.clickPlayback();
    browser.state.currentTrackId = 99;
    browser.state.isPlaying = true;
    await Vue.nextTick();
    expectButton("播放专辑", "Play");
    browser.clickPlayback();
    browser.state.currentTrackId = 2;
    await Vue.nextTick();
    expectButton("暂停当前曲目", "Pause");
    browser.state.tracks = [albumTracks[0]!];
    await Vue.nextTick();
    expectButton("播放专辑", "Play");
    browser.clickPlayback();
    browser.state.tracks = [...albumTracks];
    await Vue.nextTick();
    expectButton("暂停当前曲目", "Pause");
    browser.clickPlayback();
    expect(browser.toggles).toEqual(["togglePlayback", "togglePlayback"]);
    expect(browser.plays).toEqual([
      { albumArtist: "Artist", album: "Album" },
      { albumArtist: "Artist", album: "Album" },
    ]);
  });

  for (const blocked of [
    "playbackCommandPending",
    "trackActionPending",
    "tracksLoading",
    "emptyTracks",
  ] as const) {
    for (const currentTrackId of [1, 99]) {
      it(`disables playback for ${blocked} with current track ${currentTrackId}`, async () => {
        const browser = mountBrowser(true, {
          tracks: albumTracks,
          tracksLoading: false,
          currentTrackId,
          isPlaying: true,
        });
        if (blocked === "emptyTracks") browser.state.tracks = [];
        else browser.state[blocked] = true;
        await Vue.nextTick();
        expect(browser.playbackButton().props.disabled).toBe(true);
        // Invoke the handler directly to verify its guard, not just the DOM attribute.
        browser.clickPlayback();
        expect(browser.toggles).toEqual([]);
        expect(browser.plays).toEqual([]);
        if (blocked === "emptyTracks") browser.state.tracks = [...albumTracks];
        else browser.state[blocked] = false;
        await Vue.nextTick();
        expect(browser.playbackButton().props.disabled).toBe(false);
        browser.clickPlayback();
        expect(browser.toggles).toEqual(currentTrackId === 1 ? ["togglePlayback"] : []);
        expect(browser.plays).toEqual(
          currentTrackId === 1 ? [] : [{ albumArtist: "Artist", album: "Album" }],
        );
      });
    }
  }

  for (const isPlaying of [false, true]) {
    it(`double-clicking the current album cover always plays the album while playing=${isPlaying}`, async () => {
      const browser = mountBrowser(true, {
        tracks: albumTracks,
        tracksLoading: false,
        currentTrackId: 1,
        isPlaying,
      });
      browser.dispatch("onClick", 1);
      browser.dispatch("onClick", 2);
      browser.dispatch("onDblclick", 2);
      await waitForSingleClick();
      expect(browser.plays).toEqual([{ albumArtist: "Artist", album: "Album" }]);
      expect(browser.toggles).toEqual([]);
      expect(browser.selectedAlbum.value).toEqual({ albumArtist: "Artist", album: "Album" });
    });
  }
});

import { afterEach, beforeEach, expect, it } from "bun:test";
import * as Vue from "vue";
import type { useLibraryBrowser } from "@/features/library/browser/useBrowser";
import type { useLibrarySelection } from "@/features/library/browser/useSelection";
import type {
  AlbumSummary,
  LibraryAlbumSelection,
  LibraryGroup,
  LibraryGrouping,
  TrackSummary,
} from "@/features/library/types";
import { compileSfc, evaluateSource, transpileScript } from "../../../support/module/loader";
import { createHostNode, createHostRenderer, findNode } from "../../../support/host/renderer";

const browserSource = await Bun.file("src/features/library/browser/useBrowser.ts").text();
const selectionSource = await Bun.file("src/features/library/browser/useSelection.ts").text();
const artistSource = await Bun.file("src/features/library/browser/artists/ArtistList.vue").text();
const albumSource = await Bun.file("src/features/library/browser/albums/AlbumBrowser.vue").text();
const descriptors = new Map(
  ["window", "localStorage", "document"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
const apps: Array<{ unmount: () => void }> = [];
let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), { innerWidth: 800 }),
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: new EventTarget() });
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Vue.nextTick();
}

const albums: AlbumSummary[] = [
  { albumArtist: "Various Artists", album: "Compilation", year: 2024 },
  { albumArtist: "Other", album: "Compilation", year: 2025 },
];
const tracks: TrackSummary[] = [
  {
    id: 1,
    artist: "A",
    title: "A song",
    album: "Compilation",
    durationMs: 100,
    discNumber: 1,
    trackNumber: 1,
  },
  {
    id: 2,
    artist: "B",
    title: "B song",
    album: "Compilation",
    durationMs: 100,
    discNumber: 1,
    trackNumber: 2,
  },
];

function mountBrowser() {
  const requests: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const plays: number[][] = [];
  const next: number[][] = [];
  const queue: number[][] = [];
  const playlist: number[] = [];
  const groups = {
    albumArtist: [{ artist: "Various Artists", albumCount: 1 }],
    artist: [
      { artist: "A", albumCount: 2 },
      { artist: null, albumCount: 1 },
    ],
  };
  let deferredArtists: Promise<typeof groups.artist> | null = null;
  let deferredAlbums: Promise<AlbumSummary[]> | null = null;
  let deferredTracks: Promise<TrackSummary[]> | null = null;
  const dependencies: Record<string, unknown> = {
    vue: Vue,
    "@tauri-apps/api/core": {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        requests.push({ command, args });
        if (command === "list_artists")
          return deferredArtists ?? groups[args?.grouping as LibraryGrouping];
        if (command === "list_albums")
          return (
            deferredAlbums ??
            ((args?.group as LibraryGroup).grouping === "artist" ? albums : [albums[0]])
          );
        if (command === "list_album_tracks") {
          const group = args?.group as LibraryGroup | undefined;
          return (
            deferredTracks ??
            (group ? tracks.filter((track) => track.artist === group.artist) : tracks)
          );
        }
        if (command === "add_track_to_playlist") {
          playlist.push(args?.trackId as number);
          return;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    },
    "@/features/playback/session": {
      usePlaybackSession: () => ({
        state: {
          currentTrack: Vue.ref(null),
          activeQueueRowKey: Vue.ref(null),
          playbackStatus: Vue.ref({ isPlaying: false }),
          isPlaybackCommandPending: Vue.ref(false),
        },
        playTracks: async (items: { trackId: number }[]) => {
          plays.push(items.map((track) => track.trackId));
          return true;
        },
        addTracksToNext: async (items: { trackId: number }[]) => {
          next.push(items.map((track) => track.trackId));
          return true;
        },
        addTracksToQueueEnd: async (items: { trackId: number }[]) => {
          queue.push(items.map((track) => track.trackId));
          return true;
        },
      }),
    },
  };
  const { useLibraryBrowser: createBrowser } = evaluateSource<{
    useLibraryBrowser: typeof useLibraryBrowser;
  }>(transpileScript(browserSource), dependencies);
  let page!: ReturnType<typeof useLibraryBrowser>;
  const active = Vue.ref(true);
  const app = createHostRenderer(createHostNode).createApp({
    setup() {
      page = createBrowser(active);
      return () => null;
    },
  });
  app.mount(createHostNode("root"));
  apps.push(app);
  return {
    app,
    page,
    active,
    requests,
    plays,
    next,
    queue,
    playlist,
    groups,
    deferArtists: (value: typeof deferredArtists) => {
      deferredArtists = value;
    },
    deferAlbums: (value: typeof deferredAlbums) => {
      deferredAlbums = value;
    },
    deferTracks: (value: typeof deferredTracks) => {
      deferredTracks = value;
    },
  };
}

it("switches grouping and restores independent group and album selections after restart", async () => {
  const fixture = mountBrowser();
  await settle();
  expect(fixture.page.grouping.value).toBe("albumArtist");
  expect(fixture.page.selectedGroup.value).toBeNull();
  fixture.page.selectArtist(fixture.groups.albumArtist[0]!);
  await settle();
  fixture.page.selectAlbum(albums[0]!);
  await settle();
  expect(fixture.page.tracks.value.map((track) => track.id)).toEqual([1, 2]);
  fixture.page.selectGrouping("artist");
  await settle();
  expect(fixture.page.selectedGroup.value).toBeNull();
  expect(fixture.page.tracks.value).toEqual([]);
  fixture.page.selectArtist(fixture.groups.artist[0]!);
  await settle();
  fixture.page.selectAlbum(albums[1]!);
  await settle();
  expect(fixture.page.selectedAlbum.value).toEqual({
    albumArtist: "Other",
    album: "Compilation",
    group: { grouping: "artist", artist: "A" },
  });
  fixture.page.selectGrouping("albumArtist");
  await settle();
  expect(fixture.page.selectedAlbum.value).toEqual({
    albumArtist: "Various Artists",
    album: "Compilation",
  });
  fixture.page.selectGrouping("artist");
  await settle();
  expect(fixture.page.selectedAlbum.value?.albumArtist).toBe("Other");
  fixture.app.unmount();
  apps.splice(apps.indexOf(fixture.app), 1);
  const restarted = mountBrowser();
  await settle();
  expect(restarted.page.grouping.value).toBe("artist");
  expect(restarted.page.selectedGroup.value?.artist).toBe("A");
  expect(restarted.page.selectedAlbum.value?.albumArtist).toBe("Other");
  expect(restarted.page.tracks.value.map((track) => track.id)).toEqual([1]);
});

it("clears the selection and loading state when the selected artist disappears", async () => {
  const fixture = mountBrowser();
  await settle();
  fixture.page.selectGrouping("artist");
  await settle();
  fixture.page.selectArtist(fixture.groups.artist[0]!);
  await settle();
  fixture.page.selectAlbum(albums[0]!);
  await settle();
  fixture.groups.artist.length = 0;
  await fixture.page.refreshLibrary();
  expect(fixture.page.selectedGroup.value).toBeNull();
  expect(fixture.page.selectedAlbum.value).toBeNull();
  expect(fixture.page.albums.value).toEqual([]);
  expect(fixture.page.tracks.value).toEqual([]);
  expect(fixture.page.isLoadingTracks.value).toBe(false);
});

it("defers grouping queries while hidden and restores the mode on activation", async () => {
  const fixture = mountBrowser();
  await settle();
  fixture.active.value = false;
  fixture.requests.length = 0;
  fixture.page.selectGrouping("artist");
  await settle();
  expect(fixture.requests).toEqual([]);
  fixture.active.value = true;
  await settle();
  expect(fixture.requests).toEqual([{ command: "list_artists", args: { grouping: "artist" } }]);
  expect(fixture.page.artists.value).toEqual(fixture.groups.artist);
});

it("uses the scoped tracks for album playback, queue additions and playlist additions", async () => {
  const fixture = mountBrowser();
  await settle();
  fixture.page.selectGrouping("artist");
  await settle();
  fixture.page.selectArtist(fixture.groups.artist[0]!);
  await settle();
  fixture.page.selectAlbum(albums[0]!);
  await settle();
  const selection = fixture.page.selectedAlbum.value;
  if (!selection) throw new Error("Missing album selection");
  expect(await fixture.page.playAlbumFromLibrary(selection)).toBe(true);
  expect(await fixture.page.addAlbumToNext(selection)).toBe(true);
  expect(await fixture.page.addAlbumToQueueEnd(selection)).toBe(true);
  expect((await fixture.page.addAlbumToPlaylist(selection, 7)).successfulTrackIds).toEqual([1]);
  await fixture.page.playTrackFromLibrary(1);
  expect(fixture.plays).toEqual([[1], [1]]);
  expect(fixture.next).toEqual([[1]]);
  expect(fixture.queue).toEqual([[1]]);
  expect(fixture.playlist).toEqual([1]);
  expect(
    fixture.requests
      .filter(({ command }) => command === "list_album_tracks")
      .every(({ args }) => args?.group && (args.group as LibraryGroup).artist === "A"),
  ).toBe(true);
});

for (const request of ["artists", "albums", "tracks"] as const) {
  it(`ignores stale ${request} responses after switching grouping`, async () => {
    const fixture = mountBrowser();
    await settle();
    fixture.page.selectArtist(fixture.groups.albumArtist[0]!);
    await settle();
    fixture.page.selectAlbum(albums[0]!);
    await settle();
    let resolve!: () => void;
    if (request === "artists") {
      fixture.deferArtists(
        new Promise((done) => {
          resolve = () => done([{ artist: "Stale", albumCount: 1 }]);
        }),
      );
      void fixture.page.refreshLibrary();
      fixture.deferArtists(null);
    } else if (request === "albums") {
      fixture.deferAlbums(
        new Promise((done) => {
          resolve = () => done([albums[0]!]);
        }),
      );
      fixture.page.selectArtist(fixture.groups.albumArtist[0]!);
      fixture.deferAlbums(null);
    } else {
      fixture.deferTracks(
        new Promise((done) => {
          resolve = () => done(tracks);
        }),
      );
      fixture.page.selectAlbum(albums[0]!);
      fixture.deferTracks(null);
    }
    fixture.page.selectGrouping("artist");
    await settle();
    fixture.page.selectArtist(fixture.groups.artist[0]!);
    await settle();
    fixture.page.selectAlbum(albums[1]!);
    await settle();
    resolve();
    await settle();
    expect(fixture.page.artists.value).toEqual(fixture.groups.artist);
    expect(fixture.page.albums.value).toEqual(albums);
    expect(fixture.page.selectedAlbum.value?.albumArtist).toBe("Other");
    expect(fixture.page.tracks.value.map((track) => track.id)).toEqual([1]);
  });
}

it("handles unknown artist groups, removed albums and invalid saved selections without fallback", () => {
  const { useLibrarySelection: createSelection } = evaluateSource<{
    useLibrarySelection: typeof useLibrarySelection;
  }>(transpileScript(selectionSource), { vue: Vue });
  storage.set("newbee.library-selection", JSON.stringify({ grouping: "invalid" }));
  const selection = createSelection();
  expect(selection.grouping.value).toBe("albumArtist");
  selection.setAvailableGroups([]);
  selection.setGrouping("artist");
  selection.setAvailableGroups([{ artist: null, albumCount: 2 }]);
  selection.selectGroup({ artist: null, albumCount: 2 });
  selection.setAvailableAlbums(null, albums);
  selection.selectAlbum(albums[1]!);
  expect(selection.selectedAlbum.value?.group).toEqual({ grouping: "artist", artist: null });
  selection.setAvailableAlbums(null, [albums[0]!]);
  expect(selection.selectedAlbum.value).toBeNull();
  selection.setAvailableGroups([]);
  expect(selection.selectedGroup.value).toBeNull();
});

it("offers both grouping options and emits the selected mode", async () => {
  const placeholder = Vue.defineComponent({ render: () => null });
  const { default: ArtistList } = evaluateSource<{ default: Vue.Component }>(
    compileSfc(artistSource, "ArtistList.vue"),
    {
      vue: Vue,
      "@lucide/vue": { Check: placeholder, ChevronDown: placeholder },
      "@/features/library/browser/artists/ArtistRow.vue": placeholder,
    },
  );
  const grouping = Vue.ref<LibraryGrouping>("albumArtist");
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(ArtistList, {
        artists: [],
        selectedArtist: null,
        grouping: grouping.value,
        isLoading: false,
        error: "",
        onSelectGrouping: (value: LibraryGrouping) => {
          grouping.value = value;
        },
      }),
  });
  app.mount(root);
  apps.push(app);
  const button = findNode(root, (node) => node.props["aria-controls"] === "grouping-options");
  if (!button || typeof button.props.onClick !== "function")
    throw new Error("Missing grouping button");
  Object.assign(button, { focus: () => {} });
  button.props.onClick();
  await Vue.nextTick();
  const artistOption = findNode(
    root,
    (node) =>
      node.props.role === "menuitemradio" && node.children.some((child) => child.text === "演出者"),
  );
  if (!artistOption || typeof artistOption.props.onClick !== "function")
    throw new Error("Missing artist option");
  expect(artistOption.props["aria-checked"]).toBe(false);
  artistOption.props.onClick();
  await Vue.nextTick();
  expect(grouping.value).toBe("artist");
  expect(findNode(root, (node) => node.props.role === "menu")).toBeNull();
});

it("keeps same-name albums distinct and passes the artist scope to album menu and playback", async () => {
  const played: LibraryAlbumSelection[] = [];
  const opened: LibraryAlbumSelection[] = [];
  const selected = Vue.ref<AlbumSummary | null>(null);
  const placeholder = Vue.defineComponent({ render: () => null });
  const { default: AlbumBrowser } = evaluateSource<{ default: Vue.Component }>(
    compileSfc(albumSource, "AlbumBrowser.vue"),
    {
      vue: Vue,
      "@/features/artwork/artist/PhotoEditor.vue": placeholder,
      "@tauri-apps/api/core": { invoke: async () => [] },
      "@/features/artwork/useAlbumArtwork": {
        useAlbumArtwork: () => ({ background: Vue.ref(null) }),
      },
      "@/features/settings/composables/useCoverBackground": {
        useCoverBackground: () => Vue.ref(false),
      },
      "@/features/library/browser/albums/AlbumDetail.vue": placeholder,
      "@/features/playlist/creation/CreatePlaylistDialog.vue": placeholder,
      "@/features/library/browser/albums/AlbumCard.vue": Vue.defineComponent({
        props: ["album", "isSelected"],
        emits: ["select", "play", "contextMenu"],
        setup(props, { emit }) {
          return () =>
            Vue.h("button", {
              "data-album": props.album.albumArtist,
              "aria-pressed": props.isSelected,
              onClick: () => emit("select"),
              onDblclick: () => emit("play"),
              onContextmenu: () => emit("contextMenu", { x: 0, y: 0, trigger: null }),
            });
        },
      }),
      "@/features/library/browser/albums/AlbumContextMenu.vue": Vue.defineComponent({
        setup(_, { expose }) {
          expose({
            open: (request: { album: LibraryAlbumSelection }) => opened.push(request.album),
          });
          return () => null;
        },
      }),
    },
  );
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(AlbumBrowser, {
        artist: { artist: "A", albumCount: 2 },
        grouping: "artist",
        albums,
        selectedAlbum: selected.value,
        tracks: [],
        currentTrackId: null,
        isPlaying: false,
        playbackCommandPending: false,
        albumsLoading: false,
        albumsError: "",
        tracksLoading: false,
        tracksError: "",
        playlists: [],
        playlistsLoading: false,
        playlistsError: "",
        trackActionPending: false,
        onSelectAlbum: (album: AlbumSummary | null) => {
          selected.value = album;
        },
        onPlayAlbum: (album: LibraryAlbumSelection) => played.push(album),
      }),
  });
  app.mount(root);
  apps.push(app);
  const first = findNode(root, (node) => node.props["data-album"] === "Various Artists");
  const second = findNode(root, (node) => node.props["data-album"] === "Other");
  if (
    !first ||
    !second ||
    typeof second.props.onClick !== "function" ||
    typeof second.props.onDblclick !== "function" ||
    typeof second.props.onContextmenu !== "function"
  )
    throw new Error("Missing album cards");
  second.props.onClick();
  await Vue.nextTick();
  expect(first.props["aria-pressed"]).toBe(false);
  expect(second.props["aria-pressed"]).toBe(true);
  second.props.onDblclick();
  second.props.onContextmenu();
  const target: LibraryAlbumSelection = {
    albumArtist: "Other",
    album: "Compilation",
    group: { grouping: "artist", artist: "A" },
  };
  expect(played).toEqual([target]);
  expect(opened).toEqual([target]);
});

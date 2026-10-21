import { afterEach, beforeEach, expect } from "bun:test";
import * as Vue from "vue";
import { createRenderer, ref } from "vue";
import { transpileScript, evaluateSource } from "../module/loader";

import type { useLibraryBrowser } from "@/features/library/browser/useBrowser";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";

export async function createLibraryHarness() {
  const artist = { artist: "Artist", albumCount: 1 };
  const album = { albumArtist: "Artist", album: "Album", year: 2024 };
  const track = {
    discNumber: 1,
    trackNumber: 1,
    id: 41,
    title: "Song",
    artist: "Artist",
    album: "Album",
    durationMs: 100,
  };
  const secondTrack = {
    discNumber: 1,
    trackNumber: 2,
    id: 42,
    title: "Second song",
    artist: "Artist",
    album: "Album",
    durationMs: 120,
  };
  const thirdTrack = {
    discNumber: 1,
    trackNumber: 3,
    id: 43,
    title: "Third song",
    artist: "Artist",
    album: "Album",
    durationMs: 130,
  };
  let availableAlbums = [album];
  let availableTracks = [track];
  let playlistAddCalls: number[] = [];
  let playlistAddFailures = new Map<number, Error>();
  let albumPlaybackCalls: { trackIds: number[]; rowKey: string | null; preserveQueue: boolean }[] =
    [];
  let togglePlaybackCalls = 0;
  let queueNextBatchCalls: number[][] = [];
  let queueEndBatchCalls: number[][] = [];
  let albumTrackRequests: Record<string, unknown>[] = [];
  let albumTracksError: Error | null = null;
  let albumTracksResponse: Promise<typeof availableTracks> | null = null;
  let databaseDeleteFailures = new Map<number, Error>();
  let databaseDeleteCalls: number[] = [];

  let invokeCalls: string[] = [];
  let databaseDeleteError: Error | null = null;
  let queueRemovalResult:
    | { status: "not-found" | "removed" | "stop-unconfirmed" | "superseded" }
    | { status: "stop-failed"; message: string } = { status: "not-found" };
  let queueRemovalError: Error | null = null;
  let queueRemovalCalls: number[] = [];
  let clearQueueCalls = 0;
  const mockedCurrentTrack = ref<{
    trackId: number;
    title: string | null;
    artist: string | null;
  } | null>(null);
  const mockedIsSeeking = ref(false);
  const mockedPlaybackCommandPending = ref(false);
  const mockedPlaybackStatus = ref({ positionMs: 0 });
  const selectedGroup = ref<typeof artist | null>(null);
  const selectedAlbum = ref<{ albumArtist: string | null; album: string | null } | null>(null);
  const mountedApps: Array<{ unmount: () => void }> = [];
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  const dependencies: Record<string, unknown> = {
    vue: Vue,
    "@/features/artwork/artist/PhotoEditor.vue": Vue.defineComponent({ setup: () => () => null }),
    "@/features/artwork/artist/ArtistPhoto.vue": Vue.defineComponent({ setup: () => () => null }),
    "@/features/settings/events": { SETTINGS_CHANGED_EVENT },
  };
  dependencies["@tauri-apps/api/core"] = {
    invoke: async (command: string, args?: Record<string, unknown>) => {
      invokeCalls.push(command);
      if (command === "remove_track_from_library" && databaseDeleteError) {
        throw databaseDeleteError;
      }
      if (command === "list_artists") return [artist];
      if (command === "list_albums") return availableAlbums;
      if (command === "list_album_tracks") {
        albumTrackRequests.push(args ?? {});
        if (albumTracksError) throw albumTracksError;
        return albumTracksResponse ?? availableTracks;
      }
      if (command === "remove_track_from_library") {
        const trackId = args?.trackId as number;
        databaseDeleteCalls.push(trackId);
        const error = databaseDeleteFailures.get(trackId);
        if (error) throw error;
        availableTracks = availableTracks.filter((entry) => entry.id !== trackId);
        if (clearQueueCalls === 0) queueRemovalCalls.push(trackId);
        if (queueRemovalError) return { status: "queue-error", message: queueRemovalError.message };
        return queueRemovalResult;
      }
      if (command === "append_playlist_tracks") {
        const ids = args?.trackIds as number[];
        return ids.map((trackId, index) => {
          playlistAddCalls.push(trackId);
          const error = playlistAddFailures.get(trackId);
          return error
            ? { index, trackId, status: "failed", error: error.message }
            : { index, trackId, status: "added", playlistItemId: index + 1 };
        });
      }
      return undefined;
    },
  };

  dependencies["@/features/library/events"] = {
    LIBRARY_CHANGED_EVENT: "library-changed",
    reportLibraryRemoval: () => {
      globalThis.window.dispatchEvent(new Event("library-changed"));
    },
  };

  dependencies["@/features/library/browser/useSelection"] = {
    useLibrarySelection: () => ({
      grouping: ref("albumArtist"),
      setGrouping: () => {},
      selectedGroup,
      selectedAlbum,
      setAvailableGroups: () => {},
      setAvailableAlbums: () => {},
      selectGroup: (group: typeof artist) => {
        selectedGroup.value = group;
      },
      selectAlbum: (selected: typeof album | null) => {
        selectedAlbum.value = selected
          ? { albumArtist: selected.albumArtist, album: selected.album }
          : null;
      },
    }),
  };

  dependencies["@/features/playback/session"] = {
    PLAYBACK_STATUS_POLL_INTERVAL_MS: 500,
    usePlaybackSession: () => ({
      state: {
        currentTrack: mockedCurrentTrack,
        isSeeking: mockedIsSeeking,
        isPlaybackCommandPending: mockedPlaybackCommandPending,
        playbackStatus: mockedPlaybackStatus,
      },
      playTracks: async (
        tracks: { trackId: number }[],
        rowKey: string | null,
        preserveQueue: boolean,
      ) => {
        albumPlaybackCalls.push({
          trackIds: tracks.map((track) => track.trackId),
          rowKey,
          preserveQueue,
        });
        return true;
      },
      addTracksToNext: async (tracksToAdd: { trackId: number }[]) => {
        queueNextBatchCalls.push(tracksToAdd.map(({ trackId }) => trackId));
        return true;
      },
      addTracksToQueueEnd: async (tracksToAdd: { trackId: number }[]) => {
        queueEndBatchCalls.push(tracksToAdd.map(({ trackId }) => trackId));
        return true;
      },
      beginSeeking: () => {
        mockedIsSeeking.value = true;
      },
      refreshPlaybackStatus: async () => true,
      seekTo: async () => true,
      setRepeatOneEnabled: () => {},
      setShuffleEnabled: () => {},
      playPreviousTrack: async () => false,
      playNextTrack: async () => false,
      togglePlayback: async () => {
        togglePlaybackCalls++;
        return true;
      },
      clearQueue: async () => {
        clearQueueCalls += 1;
        if (queueRemovalError) throw queueRemovalError;
        return { status: "removed" };
      },
    }),
  };

  const { useLibraryBrowser: createLibraryPage } = evaluateSource<{
    useLibraryBrowser: typeof useLibraryBrowser;
  }>(
    transpileScript(
      await Bun.file(
        new URL("../../../src/features/library/browser/useBrowser.ts", import.meta.url),
      ).text(),
    ),
    dependencies,
  );

  function mountLibraryPage(active = ref(true)) {
    let page!: ReturnType<typeof useLibraryBrowser>;
    const renderer = createRenderer<object>({
      patchProp: () => {},
      insert: () => {},
      remove: () => {},
      createElement: () => ({}),
      createText: () => ({}),
      createComment: () => ({}),
      setText: () => {},
      setElementText: () => {},
      parentNode: () => null,
      nextSibling: () => null,
    });
    const app = renderer.createApp({
      setup() {
        page = createLibraryPage(active);
        return () => null;
      },
    });
    app.mount({});
    mountedApps.push(app);
    return page;
  }

  async function settleRequests() {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }

  async function loadTrack(page: ReturnType<typeof useLibraryBrowser>) {
    await settleRequests();
    page.selectArtist(artist);
    await settleRequests();
    page.selectAlbum(album);
    await settleRequests();
    expect(page.tracks.value).toEqual(availableTracks);
  }

  beforeEach(() => {
    invokeCalls = [];
    availableAlbums = [album];
    availableTracks = [track];
    playlistAddCalls = [];
    playlistAddFailures = new Map();
    albumPlaybackCalls = [];
    togglePlaybackCalls = 0;
    queueNextBatchCalls = [];
    queueEndBatchCalls = [];
    albumTrackRequests = [];
    albumTracksError = null;
    albumTracksResponse = null;
    databaseDeleteFailures = new Map();
    databaseDeleteCalls = [];
    databaseDeleteError = null;
    queueRemovalResult = { status: "not-found" };
    queueRemovalError = null;
    queueRemovalCalls = [];
    clearQueueCalls = 0;
    mockedCurrentTrack.value = null;
    mockedIsSeeking.value = false;
    mockedPlaybackCommandPending.value = false;
    mockedPlaybackStatus.value = { positionMs: 0 };
    selectedGroup.value = null;
    selectedAlbum.value = null;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: new EventTarget(),
    });
  });

  afterEach(() => {
    for (const app of mountedApps.splice(0)) app.unmount();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  return {
    mountedApps,
    artist,
    album,
    track,
    secondTrack,
    thirdTrack,
    mockedCurrentTrack,
    mockedIsSeeking,
    mockedPlaybackCommandPending,
    mockedPlaybackStatus,
    selectedGroup,
    selectedAlbum,
    mountLibraryPage,
    settleRequests,
    loadTrack,
    get availableAlbums() {
      return availableAlbums;
    },
    set availableAlbums(value: typeof availableAlbums) {
      availableAlbums = value;
    },
    get availableTracks() {
      return availableTracks;
    },
    set availableTracks(value: typeof availableTracks) {
      availableTracks = value;
    },
    get playlistAddCalls() {
      return playlistAddCalls;
    },
    set playlistAddCalls(value: typeof playlistAddCalls) {
      playlistAddCalls = value;
    },
    get playlistAddFailures() {
      return playlistAddFailures;
    },
    set playlistAddFailures(value: typeof playlistAddFailures) {
      playlistAddFailures = value;
    },
    get albumPlaybackCalls() {
      return albumPlaybackCalls;
    },
    set albumPlaybackCalls(value: typeof albumPlaybackCalls) {
      albumPlaybackCalls = value;
    },
    get togglePlaybackCalls() {
      return togglePlaybackCalls;
    },
    set togglePlaybackCalls(value: typeof togglePlaybackCalls) {
      togglePlaybackCalls = value;
    },
    get queueNextBatchCalls() {
      return queueNextBatchCalls;
    },
    set queueNextBatchCalls(value: typeof queueNextBatchCalls) {
      queueNextBatchCalls = value;
    },
    get queueEndBatchCalls() {
      return queueEndBatchCalls;
    },
    set queueEndBatchCalls(value: typeof queueEndBatchCalls) {
      queueEndBatchCalls = value;
    },
    get albumTrackRequests() {
      return albumTrackRequests;
    },
    set albumTrackRequests(value: typeof albumTrackRequests) {
      albumTrackRequests = value;
    },
    get albumTracksError() {
      return albumTracksError;
    },
    set albumTracksError(value: typeof albumTracksError) {
      albumTracksError = value;
    },
    get albumTracksResponse() {
      return albumTracksResponse;
    },
    set albumTracksResponse(value: typeof albumTracksResponse) {
      albumTracksResponse = value;
    },
    get databaseDeleteFailures() {
      return databaseDeleteFailures;
    },
    set databaseDeleteFailures(value: typeof databaseDeleteFailures) {
      databaseDeleteFailures = value;
    },
    get databaseDeleteCalls() {
      return databaseDeleteCalls;
    },
    set databaseDeleteCalls(value: typeof databaseDeleteCalls) {
      databaseDeleteCalls = value;
    },
    get invokeCalls() {
      return invokeCalls;
    },
    set invokeCalls(value: typeof invokeCalls) {
      invokeCalls = value;
    },
    get databaseDeleteError() {
      return databaseDeleteError;
    },
    set databaseDeleteError(value: typeof databaseDeleteError) {
      databaseDeleteError = value;
    },
    get queueRemovalResult() {
      return queueRemovalResult;
    },
    set queueRemovalResult(value: typeof queueRemovalResult) {
      queueRemovalResult = value;
    },
    get queueRemovalError() {
      return queueRemovalError;
    },
    set queueRemovalError(value: typeof queueRemovalError) {
      queueRemovalError = value;
    },
    get queueRemovalCalls() {
      return queueRemovalCalls;
    },
    set queueRemovalCalls(value: typeof queueRemovalCalls) {
      queueRemovalCalls = value;
    },
    get clearQueueCalls() {
      return clearQueueCalls;
    },
    set clearQueueCalls(value: typeof clearQueueCalls) {
      clearQueueCalls = value;
    },
  };
}

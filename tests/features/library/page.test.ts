import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { createRenderer, ref } from "vue";
import { transpileScript, evaluateSource } from "../../support/module/loader";

import type { useLibraryBrowser } from "@/features/library/browser/useBrowser";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";

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

describe("album playback by selection", () => {
  it("loads the target album without requiring its detail to be selected", async () => {
    const page = mountLibraryPage();
    await settleRequests();
    availableTracks = [track, secondTrack, thirdTrack];
    const target = { albumArtist: "Other Artist", album: "Other Album" };
    expect(await page.playAlbumFromLibrary(target)).toBe(true);
    expect(albumTrackRequests).toEqual([target]);
    expect(albumPlaybackCalls).toEqual([
      { trackIds: [41, 42, 43], rowKey: null, preserveQueue: false },
    ]);
    expect(page.selectedAlbum.value).toBeNull();
    expect(page.tracks.value).toEqual([]);
  });

  it("does not start playback for an empty album or a failed track request", async () => {
    const page = mountLibraryPage();
    await settleRequests();
    availableTracks = [];
    const target = { albumArtist: null, album: null };
    expect(await page.playAlbumFromLibrary(target)).toBe(false);
    albumTracksError = new Error("Database unavailable");
    expect(await page.playAlbumFromLibrary(target)).toBe(false);
    expect(albumPlaybackCalls).toEqual([]);
    expect(page.trackActionError.value).toBe("播放专辑失败");
    expect(page.isTrackActionPending.value).toBe(false);
  });
});

describe("current album playback controls", () => {
  it("toggles the current track without replacing the queue or loading the album again", async () => {
    const page = mountLibraryPage();
    await loadTrack(page);
    mockedCurrentTrack.value = { trackId: track.id, title: track.title, artist: track.artist };
    const requestCount = albumTrackRequests.length;
    expect(await page.toggleCurrentAlbumPlayback()).toBe(true);
    expect(togglePlaybackCalls).toBe(1);
    expect(albumPlaybackCalls).toEqual([]);
    expect(albumTrackRequests).toHaveLength(requestCount);
  });

  it("always restarts the album even when its current track can be toggled", async () => {
    const page = mountLibraryPage();
    await loadTrack(page);
    mockedCurrentTrack.value = { trackId: track.id, title: track.title, artist: track.artist };
    availableTracks = [track, secondTrack];
    expect(await page.playAlbumFromLibrary({ albumArtist: "Artist", album: "Album" })).toBe(true);
    expect(togglePlaybackCalls).toBe(0);
    expect(albumPlaybackCalls).toEqual([
      { trackIds: [41, 42], rowKey: null, preserveQueue: false },
    ]);
  });

  it("does not toggle another album's track or act while loading or pending", async () => {
    const page = mountLibraryPage();
    await loadTrack(page);
    mockedCurrentTrack.value = { trackId: 999, title: track.title, artist: track.artist };
    expect(await page.toggleCurrentAlbumPlayback()).toBe(false);
    mockedCurrentTrack.value = { trackId: track.id, title: track.title, artist: track.artist };
    page.isLoadingTracks.value = true;
    expect(await page.toggleCurrentAlbumPlayback()).toBe(false);
    page.isLoadingTracks.value = false;
    mockedPlaybackCommandPending.value = true;
    expect(await page.toggleCurrentAlbumPlayback()).toBe(false);
    mockedPlaybackCommandPending.value = false;
    page.isTrackActionPending.value = true;
    expect(await page.toggleCurrentAlbumPlayback()).toBe(false);
    expect(togglePlaybackCalls).toBe(0);
    expect(albumPlaybackCalls).toEqual([]);
  });
});

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

describe("library page switching", () => {
  it("loads once on first activation when initially hidden", async () => {
    const active = ref(false);
    const page = mountLibraryPage(active);
    await settleRequests();
    expect(invokeCalls).toEqual([]);
    active.value = true;
    await settleRequests();
    expect(page.artists.value).toEqual([artist]);
    expect(invokeCalls).toEqual(["list_artists"]);
    active.value = false;
    active.value = true;
    await settleRequests();
    expect(invokeCalls).toEqual(["list_artists"]);
  });

  it("retries interrupted loading and ignores results from before deactivation", async () => {
    const active = ref(true);
    const page = mountLibraryPage(active);
    await loadTrack(page);
    let resolveOld!: (tracks: typeof availableTracks) => void;
    albumTracksResponse = new Promise((resolve) => {
      resolveOld = resolve;
    });
    page.selectAlbum(album);
    expect(page.isLoadingTracks.value).toBe(true);
    active.value = false;
    albumTracksResponse = null;
    availableTracks = [secondTrack];
    active.value = true;
    await settleRequests();
    expect(page.tracks.value).toEqual([secondTrack]);
    resolveOld([track]);
    await settleRequests();
    expect(page.tracks.value).toEqual([secondTrack]);
    expect(page.isLoadingTracks.value).toBe(false);
  });

  it("keeps loaded albums and tracks without queries or loading states on reactivation", async () => {
    const active = ref(true);
    const page = mountLibraryPage(active);
    await loadTrack(page);
    const artists = page.artists.value;
    const albums = page.albums.value;
    const tracks = page.tracks.value;
    invokeCalls = [];

    for (let index = 0; index < 3; index += 1) {
      active.value = false;
      active.value = true;
      expect(page.isLoadingArtists.value).toBe(false);
      expect(page.isLoadingAlbums.value).toBe(false);
      expect(page.isLoadingTracks.value).toBe(false);
      await settleRequests();
      expect(page.artists.value).toBe(artists);
      expect(page.albums.value).toBe(albums);
      expect(page.tracks.value).toBe(tracks);
    }
    expect(invokeCalls).toEqual([]);
  });

  it("defers and coalesces library changes while hidden, then refreshes once", async () => {
    const active = ref(true);
    const page = mountLibraryPage(active);
    await loadTrack(page);
    active.value = false;
    invokeCalls = [];
    availableTracks = [track, secondTrack];
    globalThis.window.dispatchEvent(new Event("library-changed"));
    globalThis.window.dispatchEvent(new Event("library-changed"));
    await settleRequests();
    expect(invokeCalls).toEqual([]);
    active.value = true;
    await settleRequests();
    expect(page.tracks.value).toEqual(availableTracks);
    expect(invokeCalls).toEqual(["list_artists", "list_albums", "list_album_tracks"]);
    invokeCalls = [];
    active.value = false;
    active.value = true;
    await settleRequests();
    expect(invokeCalls).toEqual([]);
  });
});

describe("library album sorting updates", () => {
  it("refreshes albums after settings save without changing the expanded album", async () => {
    const page = mountLibraryPage();
    await loadTrack(page);
    const selection = page.selectedAlbum.value;
    if (!selection) throw new Error("Album selection was not initialized.");
    availableAlbums = [{ albumArtist: "Artist", album: "New album", year: 2025 }, album];
    globalThis.window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
    await settleRequests();
    expect(page.albums.value).toEqual(availableAlbums);
    expect(page.selectedAlbum.value).toEqual(selection);
    expect(page.tracks.value).toEqual(availableTracks);
    expect(invokeCalls.filter((command) => command === "list_albums")).toHaveLength(2);
  });

  it("uses the latest ordering when reactivated and stops listening when unmounted", async () => {
    const active = ref(true);
    const page = mountLibraryPage(active);
    await loadTrack(page);
    active.value = false;
    availableAlbums = [{ albumArtist: "Artist", album: "New album", year: 2025 }, album];
    const beforeUpdate = invokeCalls.length;
    globalThis.window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
    await settleRequests();
    expect(invokeCalls).toHaveLength(beforeUpdate);
    active.value = true;
    await settleRequests();
    expect(page.albums.value).toEqual(availableAlbums);
    for (const app of mountedApps.splice(0)) app.unmount();
    const beforeUnmount = invokeCalls.length;
    globalThis.window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
    await settleRequests();
    expect(invokeCalls).toHaveLength(beforeUnmount);
  });
});

describe("library album actions", () => {
  const selection = { albumArtist: "Other artist", album: "Other album" };

  it("loads the target album without expanding it and queues all tracks in order", async () => {
    availableTracks = [track, secondTrack, thirdTrack];
    const page = mountLibraryPage();
    await settleRequests();

    expect(await page.addAlbumToNext(selection)).toBe(true);
    expect(await page.addAlbumToQueueEnd(selection)).toBe(true);
    expect(albumTrackRequests).toEqual([selection, selection]);
    expect(queueNextBatchCalls).toEqual([[track.id, secondTrack.id, thirdTrack.id]]);
    expect(queueEndBatchCalls).toEqual([[track.id, secondTrack.id, thirdTrack.id]]);
    expect(page.selectedAlbum.value).toBeNull();
    expect(page.tracks.value).toEqual([]);
  });

  it("adds the whole album to a playlist and continues after an item fails", async () => {
    availableTracks = [track, secondTrack, thirdTrack];
    playlistAddFailures.set(secondTrack.id, new Error("permission denied"));
    const page = mountLibraryPage();
    await settleRequests();

    const result = await page.addAlbumToPlaylist(selection, 3);

    expect(result.successfulTrackIds).toEqual([track.id, thirdTrack.id]);
    expect(playlistAddCalls).toEqual([track.id, secondTrack.id, thirdTrack.id]);
    expect(page.trackActionMessage.value).toContain("1 首失败");
    expect(page.isTrackActionPending.value).toBe(false);
  });

  it("deletes every album track and cleans the queue with one library refresh", async () => {
    availableTracks = [track, secondTrack, thirdTrack];
    const page = mountLibraryPage();
    await settleRequests();

    const result = await page.removeAlbumFromLibrary(selection);

    expect(result).toEqual({ completed: true, deletedCount: 3, message: "" });
    expect(page.trackActionMessage.value).toBe("");
    expect(databaseDeleteCalls).toEqual([track.id, secondTrack.id, thirdTrack.id]);
    expect(queueRemovalCalls).toEqual([track.id, secondTrack.id, thirdTrack.id]);
    expect(invokeCalls.filter((command) => command === "list_artists")).toHaveLength(2);
  });

  it("clears playback and the entire queue when deleting the active track's album", async () => {
    availableTracks = [track, secondTrack, thirdTrack];
    mockedCurrentTrack.value = {
      trackId: secondTrack.id,
      title: secondTrack.title,
      artist: "Artist",
    };
    const page = mountLibraryPage();
    await settleRequests();

    const result = await page.removeAlbumFromLibrary(selection);

    expect(result).toEqual({ completed: true, deletedCount: 3, message: "" });
    expect(clearQueueCalls).toBe(1);
    expect(queueRemovalCalls).toEqual([]);
    expect(databaseDeleteCalls).toEqual([track.id, secondTrack.id, thirdTrack.id]);
  });

  it("reports zero deletions accurately and allows retrying the failed album", async () => {
    availableTracks = [track, secondTrack];
    databaseDeleteFailures.set(track.id, new Error("database busy"));
    databaseDeleteFailures.set(secondTrack.id, new Error("database busy"));
    const page = mountLibraryPage();
    await settleRequests();
    const result = await page.removeAlbumFromLibrary(selection);
    expect(result.completed).toBe(false);
    expect(result.deletedCount).toBe(0);
    expect(result.message).toBe("已从曲库移除 0 首，2 首移除失败");
    expect(page.trackActionRemoval.value).toEqual({
      deletedCount: 0,
      failedCount: 2,
      queueSyncFailed: false,
    });
    expect(queueRemovalCalls).toEqual([]);
    databaseDeleteFailures.clear();
    const retried = await page.removeAlbumFromLibrary(selection);
    expect(retried).toEqual({ completed: true, deletedCount: 2, message: "" });
    expect(page.trackActionRemoval.value).toEqual({
      deletedCount: 2,
      failedCount: 0,
      queueSyncFailed: false,
    });
  });

  it("reports partial deletion and continues deleting the remaining tracks", async () => {
    availableTracks = [track, secondTrack, thirdTrack];
    databaseDeleteFailures.set(secondTrack.id, new Error("database busy"));
    const page = mountLibraryPage();
    await settleRequests();

    const result = await page.removeAlbumFromLibrary(selection);

    expect(result.completed).toBe(false);
    expect(result.deletedCount).toBe(2);
    expect(page.trackActionRemoval.value).toEqual({
      deletedCount: 2,
      failedCount: 1,
      queueSyncFailed: false,
    });
    expect(page.trackActionMessage.value).toBe("已从曲库删除 2 首曲目。");
    expect(result.message).toBe("已从曲库移除 2 首，1 首移除失败");
    expect(queueRemovalCalls).toEqual([track.id, thirdTrack.id]);
  });

  it("reports a fetch failure without modifying the queue or database", async () => {
    const page = mountLibraryPage();
    await settleRequests();
    albumTracksError = new Error("database unavailable");

    expect(await page.addAlbumToNext(selection)).toBe(false);
    expect((await page.removeAlbumFromLibrary(selection)).completed).toBe(false);
    expect(queueNextBatchCalls).toEqual([]);
    expect(databaseDeleteCalls).toEqual([]);
    expect(page.trackActionError.value).toBe("从曲库删除专辑失败");
    expect(page.isTrackActionPending.value).toBe(false);
  });
});

describe("library track actions", () => {
  it("submits a visible-order batch as one queue addition", async () => {
    availableTracks = [track, secondTrack];
    const page = mountLibraryPage();
    await loadTrack(page);

    expect(await page.addTracksToNext([secondTrack.id, track.id])).toBe(true);
    expect(queueNextBatchCalls).toEqual([[secondTrack.id, track.id]]);
  });

  it("continues playlist additions after failures and reports every failed item", async () => {
    availableTracks = [track, secondTrack, thirdTrack];
    playlistAddFailures.set(secondTrack.id, new Error("permission denied"));
    const page = mountLibraryPage();
    await loadTrack(page);

    const result = await page.addTracksToPlaylist([track.id, secondTrack.id, thirdTrack.id], 3);

    expect(playlistAddCalls).toEqual([track.id, secondTrack.id, thirdTrack.id]);
    expect(result).toEqual({
      successfulTrackIds: [track.id, thirdTrack.id],
      failures: [
        {
          trackId: secondTrack.id,
          trackName: secondTrack.title,
          message: "permission denied",
        },
      ],
    });
    expect(page.trackActionMessage.value).toBe("已添加 2 首，1 首失败");
  });

  it("keeps deletion failure separate and does not clean the playback queue", async () => {
    const page = mountLibraryPage();
    await loadTrack(page);
    databaseDeleteError = new Error("database unavailable");

    const result = await page.removeTrackFromLibrary(track.id);

    expect(result).toEqual({
      status: "not-deleted",
      message: "从曲库移除失败",
    });
    expect(queueRemovalCalls).toEqual([]);
    expect(invokeCalls.filter((command) => command === "remove_track_from_library")).toHaveLength(
      1,
    );
    expect(page.trackActionError.value).toBe("从曲库移除失败");
    expect(invokeCalls.filter((command) => command === "list_artists")).toHaveLength(1);
  });

  it("treats a missing queue row as a complete deletion", async () => {
    const page = mountLibraryPage();
    await loadTrack(page);

    const result = await page.removeTrackFromLibrary(track.id);

    expect(result).toEqual({ status: "deleted" });
    expect(queueRemovalCalls).toEqual([track.id]);
    expect(invokeCalls.filter((command) => command === "remove_track_from_library")).toHaveLength(
      1,
    );
    expect(invokeCalls.filter((command) => command === "list_artists")).toHaveLength(2);
    expect(page.trackActionError.value).toBe("");
  });

  it("returns a partial-success warning after a current-track stop failure", async () => {
    const page = mountLibraryPage();
    await loadTrack(page);
    queueRemovalResult = { status: "stop-failed", message: "device busy" };

    const result = await page.removeTrackFromLibrary(track.id);

    expect(result).toEqual({
      status: "deleted-queue-sync-failed",
      issue: "stop-failed",
      message: "曲库索引已删除，但停止当前播放失败：device busy",
    });
    expect(page.trackActionError.value).toBe("曲库索引已删除，但停止当前播放失败：device busy");
    expect(queueRemovalCalls).toEqual([track.id]);
    expect(invokeCalls.filter((command) => command === "remove_track_from_library")).toHaveLength(
      1,
    );
    expect(invokeCalls.filter((command) => command === "list_artists")).toHaveLength(2);
  });

  it("does not report queue exceptions as stop failures", async () => {
    const page = mountLibraryPage();
    await loadTrack(page);
    queueRemovalError = new Error("queue persistence failed");

    const result = await page.removeTrackFromLibrary(track.id);

    expect(result).toMatchObject({
      status: "deleted-queue-sync-failed",
      issue: "queue-error",
    });
    expect(page.trackActionError.value).toContain("播放队列同步失败：queue persistence failed");
    expect(invokeCalls.filter((command) => command === "remove_track_from_library")).toHaveLength(
      1,
    );
  });

  it("does not report superseded cleanup as a stop failure", async () => {
    const page = mountLibraryPage();
    await loadTrack(page);
    queueRemovalResult = { status: "superseded" };

    const result = await page.removeTrackFromLibrary(track.id);

    expect(result).toMatchObject({
      status: "deleted-queue-sync-failed",
      issue: "superseded",
    });
    expect(page.trackActionError.value).toContain("被较新的播放操作取代");
    expect(invokeCalls.filter((command) => command === "remove_track_from_library")).toHaveLength(
      1,
    );
  });
});

// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createRenderer, ref } from "vue";
import type { useLibraryPage } from "@/library/usePage";

const artist = { albumArtist: "Artist", albumCount: 1 };
const album = { album: "Album", year: 2024 };
const track = {
  id: 41,
  title: "Song",
  artist: "Artist",
  album: "Album",
  durationMs: 100,
};
const secondTrack = {
  id: 42,
  title: "Second song",
  artist: "Artist",
  album: "Album",
  durationMs: 120,
};
const thirdTrack = {
  id: 43,
  title: "Third song",
  artist: "Artist",
  album: "Album",
  durationMs: 130,
};
let availableTracks = [track];
let playlistAddCalls: number[] = [];
let playlistAddFailures = new Map<number, Error>();
let queueNextBatchCalls: number[][] = [];
let queueEndBatchCalls: number[][] = [];
let albumTrackRequests: Record<string, unknown>[] = [];
let albumTracksError: Error | null = null;
let databaseDeleteFailures = new Map<number, Error>();
let databaseDeleteCalls: number[] = [];

let invokeCalls: string[] = [];
let databaseDeleteError: Error | null = null;
let queueRemovalResult:
  | { status: "not-found" | "removed" | "stop-unconfirmed" | "superseded" }
  | { status: "stop-failed"; message: string } = { status: "not-found" };
let queueRemovalError: Error | null = null;
let queueRemovalCalls: number[] = [];
const mockedIsSeeking = ref(false);
const mockedPlaybackCommandPending = ref(false);
const mockedPlaybackStatus = ref({ positionMs: 0 });
const selectedGroup = ref<typeof artist | null>(null);
const selectedAlbum = ref<{ albumArtist: string | null; album: string | null } | null>(null);
const mountedApps: Array<{ unmount: () => void }> = [];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    invokeCalls.push(command);
    if (command === "remove_track_from_library" && databaseDeleteError) {
      throw databaseDeleteError;
    }
    if (command === "list_album_artists") return [artist];
    if (command === "list_albums") return [album];
    if (command === "list_album_tracks") {
      albumTrackRequests.push(args ?? {});
      if (albumTracksError) throw albumTracksError;
      return availableTracks;
    }
    if (command === "remove_track_from_library") {
      const trackId = args?.trackId as number;
      databaseDeleteCalls.push(trackId);
      const error = databaseDeleteFailures.get(trackId);
      if (error) throw error;
      availableTracks = availableTracks.filter((entry) => entry.id !== trackId);
    }
    if (command === "add_track_to_playlist") {
      const trackId = args?.trackId as number;
      playlistAddCalls.push(trackId);
      const error = playlistAddFailures.get(trackId);
      if (error) throw error;
      return undefined;
    }
    return undefined;
  },
}));

mock.module("@/library/scan", () => ({
  LIBRARY_SCAN_COMPLETED_EVENT: "library-scan-completed",
}));

mock.module("@/library/selection", () => ({
  usePersistentLibrarySelection: () => ({
    selectedGroup,
    selectedAlbum,
    setAvailableGroups: () => {},
    setAvailableAlbums: () => {},
    selectGroup: (group: typeof artist) => {
      selectedGroup.value = group;
    },
    selectAlbum: (selected: typeof album | null) => {
      selectedAlbum.value = selected
        ? { albumArtist: selectedGroup.value?.albumArtist ?? null, album: selected.album }
        : null;
    },
  }),
}));

mock.module("@/playback/session", () => ({
  PLAYBACK_STATUS_POLL_INTERVAL_MS: 500,
  usePlaybackSession: () => ({
    state: {
      currentTrack: ref(null),
      isSeeking: mockedIsSeeking,
      isPlaybackCommandPending: mockedPlaybackCommandPending,
      playbackStatus: mockedPlaybackStatus,
    },
    playTracks: async () => true,
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
    togglePlayback: async () => false,
    removeTrackFromQueue: async (trackId: number) => {
      queueRemovalCalls.push(trackId);
      if (queueRemovalError) throw queueRemovalError;
      return queueRemovalResult;
    },
  }),
}));

const { useLibraryPage: createLibraryPage } = await import("@/library/usePage");

function mountLibraryPage() {
  let page!: ReturnType<typeof useLibraryPage>;
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
      page = createLibraryPage(ref(true));
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

async function loadTrack(page: ReturnType<typeof useLibraryPage>) {
  await settleRequests();
  page.selectArtist(artist);
  await settleRequests();
  page.selectAlbum(album);
  await settleRequests();
  expect(page.tracks.value).toEqual(availableTracks);
}

beforeEach(() => {
  invokeCalls = [];
  availableTracks = [track];
  playlistAddCalls = [];
  playlistAddFailures = new Map();
  queueNextBatchCalls = [];
  queueEndBatchCalls = [];
  albumTrackRequests = [];
  albumTracksError = null;
  databaseDeleteFailures = new Map();
  databaseDeleteCalls = [];
  databaseDeleteError = null;
  queueRemovalResult = { status: "not-found" };
  queueRemovalError = null;
  queueRemovalCalls = [];
  mockedIsSeeking.value = false;
  mockedPlaybackCommandPending.value = false;
  mockedPlaybackStatus.value = { positionMs: 0 };
  selectedGroup.value = null;
  selectedAlbum.value = null;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener: () => {}, removeEventListener: () => {} },
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
    expect(databaseDeleteCalls).toEqual([track.id, secondTrack.id, thirdTrack.id]);
    expect(queueRemovalCalls).toEqual([track.id, secondTrack.id, thirdTrack.id]);
    expect(invokeCalls.filter((command) => command === "list_album_artists")).toHaveLength(2);
  });

  it("reports partial deletion and continues deleting the remaining tracks", async () => {
    availableTracks = [track, secondTrack, thirdTrack];
    databaseDeleteFailures.set(secondTrack.id, new Error("database busy"));
    const page = mountLibraryPage();
    await settleRequests();

    const result = await page.removeAlbumFromLibrary(selection);

    expect(result.completed).toBe(false);
    expect(result.deletedCount).toBe(2);
    expect(result.message).toContain("Second song（从曲库删除失败：database busy）");
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
    expect(page.trackActionError.value).toContain("database unavailable");
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
    expect(page.trackActionMessage.value).toBe(
      "已成功添加 2 首；1 首失败：Second song（permission denied）",
    );
  });

  it("keeps deletion failure separate and does not clean the playback queue", async () => {
    const page = mountLibraryPage();
    await loadTrack(page);
    databaseDeleteError = new Error("database unavailable");

    const result = await page.removeTrackFromLibrary(track.id);

    expect(result).toEqual({
      status: "not-deleted",
      message: "从曲库删除失败：database unavailable",
    });
    expect(queueRemovalCalls).toEqual([]);
    expect(invokeCalls.filter((command) => command === "remove_track_from_library")).toHaveLength(
      1,
    );
    expect(page.trackActionError.value).toContain("database unavailable");
    expect(invokeCalls.filter((command) => command === "list_album_artists")).toHaveLength(1);
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
    expect(invokeCalls.filter((command) => command === "list_album_artists")).toHaveLength(2);
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
    expect(invokeCalls.filter((command) => command === "list_album_artists")).toHaveLength(2);
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

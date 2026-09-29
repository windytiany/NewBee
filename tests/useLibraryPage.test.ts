// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createRenderer, ref } from "vue";
import type { useLibraryPage } from "@/composables/useLibraryPage";

const artist = { albumArtist: "Artist", albumCount: 1 };
const album = { album: "Album", year: 2024 };
const track = {
  id: 41,
  title: "Song",
  artist: "Artist",
  album: "Album",
  durationMs: 100,
};

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
  invoke: async (command: string) => {
    invokeCalls.push(command);
    if (command === "remove_track_from_library" && databaseDeleteError) {
      throw databaseDeleteError;
    }
    if (command === "list_album_artists") return [artist];
    if (command === "list_albums") return [album];
    if (command === "list_album_tracks") return [track];
    return undefined;
  },
}));

mock.module("@/composables/useLibraryScan", () => ({
  LIBRARY_SCAN_COMPLETED_EVENT: "library-scan-completed",
}));

mock.module("@/composables/usePersistentLibrarySelection", () => ({
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

mock.module("@/composables/usePlaybackSession", () => ({
  PLAYBACK_STATUS_POLL_INTERVAL_MS: 500,
  usePlaybackSession: () => ({
    state: {
      currentTrack: ref(null),
      isSeeking: mockedIsSeeking,
      isPlaybackCommandPending: mockedPlaybackCommandPending,
      playbackStatus: mockedPlaybackStatus,
    },
    playTracks: async () => true,
    addToNext: async () => true,
    addToQueueEnd: async () => true,
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

const { useLibraryPage: createLibraryPage } = await import("@/composables/useLibraryPage");

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
  expect(page.tracks.value).toEqual([track]);
}

beforeEach(() => {
  invokeCalls = [];
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

describe("library track deletion", () => {
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

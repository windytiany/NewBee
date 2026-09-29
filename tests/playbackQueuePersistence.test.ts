// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { describe, expect, it } from "bun:test";
import { PlaybackQueueCoordinator } from "@/composables/playbackQueueCoordinator";
import {
  createPlaybackQueueSnapshotWriter,
  loadPlaybackQueueSnapshot,
  parsePlaybackQueueSnapshot,
  savePlaybackQueueSnapshot,
  type PlaybackQueuePersistenceSnapshot,
} from "@/composables/playbackQueuePersistence";

type MemoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const STORAGE_KEY = "newbee.playback-queue";

function createMemoryStorage(): MemoryStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

const snapshot: PlaybackQueuePersistenceSnapshot = {
  displayedTracks: [
    { rowKey: "playlist-item:11", trackId: 7, title: "First", album: null, durationMs: 1200 },
    { rowKey: "album-track:7", trackId: 7, title: null, album: "Second", durationMs: null },
  ],
  currentRowKey: "album-track:7",
  shuffleEnabled: true,
  repeatOneEnabled: true,
};

describe("playback queue persistence", () => {
  it("round-trips ordered rows and modes, keeping duplicate track IDs distinct by rowKey", () => {
    const storage = createMemoryStorage();

    expect(savePlaybackQueueSnapshot(snapshot, () => storage)).toBe(true);
    expect(loadPlaybackQueueSnapshot(() => storage)).toEqual(snapshot);
    expect(JSON.parse(storage.values.get(STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      ...snapshot,
    });
  });

  it("writes only allowlisted fields from coordinator snapshots", () => {
    const storage = createMemoryStorage();
    const writer = createPlaybackQueueSnapshotWriter(null, () => storage);

    const coordinatorSnapshot = {
      ...snapshot,
      queuePlaybackError: "not persisted",
      canPlayPrevious: true,
      canPlayNext: true,
      displayedTracks: snapshot.displayedTracks.map((track) => ({ ...track, playbackId: 91 })),
    };
    writer(coordinatorSnapshot);

    expect(JSON.parse(storage.values.get(STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      ...snapshot,
    });
  });

  it("persists unique row keys for manually added duplicate tracks across restore", async () => {
    const storage = createMemoryStorage();
    let playbackAttempts = 0;
    const coordinator = new PlaybackQueueCoordinator(
      async (_trackId, canStart) => {
        playbackAttempts += 1;
        return canStart() ? { status: "started", playbackId: 1 } : { status: "cancelled" };
      },
      createPlaybackQueueSnapshotWriter(null, () => storage),
    );
    coordinator.restoreQueue({
      displayedTracks: [],
      currentRowKey: null,
      shuffleEnabled: false,
      repeatOneEnabled: false,
    });

    await coordinator.addToQueueEnd({ trackId: 7, title: "same", album: null, durationMs: null });
    await coordinator.addToQueueEnd({ trackId: 7, title: "same", album: null, durationMs: null });
    expect(playbackAttempts).toBe(0);
    const savedSnapshot = loadPlaybackQueueSnapshot(() => storage);

    expect(savedSnapshot?.displayedTracks).toHaveLength(2);
    expect(savedSnapshot?.displayedTracks.map((track) => track.trackId)).toEqual([7, 7]);
    expect(new Set(savedSnapshot?.displayedTracks.map((track) => track.rowKey)).size).toBe(2);
    if (!savedSnapshot) return;

    const restoredCoordinator = new PlaybackQueueCoordinator(
      async () => ({
        status: "started",
        playbackId: 2,
      }),
      () => {},
    );
    restoredCoordinator.restoreQueue(savedSnapshot);
    await restoredCoordinator.addToNext({
      trackId: 7,
      title: "same",
      album: null,
      durationMs: null,
    });

    const restoredRows = restoredCoordinator.snapshot.displayedTracks;
    expect(restoredRows).toHaveLength(3);
    expect(restoredRows.map((track) => track.trackId)).toEqual([7, 7, 7]);
    expect(new Set(restoredRows.map((track) => track.rowKey)).size).toBe(3);
  });

  it("restores added-next rows ahead of shuffled queue items", async () => {
    const storage = createMemoryStorage();
    let nextPlaybackId = 0;
    const options = { random: () => 0 };
    const coordinator = new PlaybackQueueCoordinator(
      async (_trackId, canStart) =>
        canStart() ? { status: "started", playbackId: ++nextPlaybackId } : { status: "cancelled" },
      createPlaybackQueueSnapshotWriter(null, () => storage),
      options,
    );
    coordinator.restoreQueue({
      displayedTracks: [],
      currentRowKey: null,
      shuffleEnabled: true,
      repeatOneEnabled: false,
    });
    await coordinator.addToNext({ trackId: 3, title: "A", album: null, durationMs: null });
    await coordinator.addToNext({ trackId: 4, title: "B", album: null, durationMs: null });
    await coordinator.addToQueueEnd({ trackId: 5, title: "tail", album: null, durationMs: null });

    const savedSnapshot = loadPlaybackQueueSnapshot(() => storage);
    expect(savedSnapshot).not.toBeNull();
    if (!savedSnapshot) return;

    const attempts: number[] = [];
    const restoredCoordinator = new PlaybackQueueCoordinator(
      async (trackId, canStart) => {
        attempts.push(trackId);
        return canStart()
          ? { status: "started", playbackId: ++nextPlaybackId }
          : { status: "cancelled" };
      },
      () => {},
      options,
    );
    restoredCoordinator.restoreQueue(savedSnapshot);
    expect(restoredCoordinator.snapshot.currentRowKey).toBeNull();
    expect(await restoredCoordinator.playNext()).toBe(true);
    expect(await restoredCoordinator.playNext()).toBe(true);
    expect(await restoredCoordinator.playNext()).toBe(true);
    expect(attempts).toEqual([4, 3, 5]);
  });

  it("persists mode changes and successful automatic track advances", async () => {
    const storage = createMemoryStorage();
    let nextPlaybackId = 0;
    const coordinator = new PlaybackQueueCoordinator(
      async (_trackId, canStart) =>
        canStart() ? { status: "started", playbackId: ++nextPlaybackId } : { status: "cancelled" },
      createPlaybackQueueSnapshotWriter(null, () => storage),
    );
    const queue = snapshot.displayedTracks;
    coordinator.restoreQueue({
      displayedTracks: [],
      currentRowKey: null,
      shuffleEnabled: false,
      repeatOneEnabled: false,
    });

    expect(await coordinator.replaceAndPlay(queue, "playlist-item:11")).toBe(true);
    coordinator.setShuffleEnabled(true);
    await coordinator.observePlaybackState(1, false, true);
    coordinator.setRepeatOneEnabled(true);

    expect(loadPlaybackQueueSnapshot(() => storage)).toEqual({
      ...snapshot,
      currentRowKey: "album-track:7",
      shuffleEnabled: true,
      repeatOneEnabled: true,
    });
  });

  it("keeps a removed row out of the next restored snapshot", async () => {
    const storage = createMemoryStorage();
    expect(savePlaybackQueueSnapshot(snapshot, () => storage)).toBe(true);
    const restoredSnapshot = loadPlaybackQueueSnapshot(() => storage);
    expect(restoredSnapshot).not.toBeNull();
    if (restoredSnapshot === null) return;

    const coordinator = new PlaybackQueueCoordinator(
      async (_trackId, canStart) =>
        canStart() ? { status: "started", playbackId: 1 } : { status: "cancelled" },
      createPlaybackQueueSnapshotWriter(restoredSnapshot, () => storage),
    );
    coordinator.restoreQueue(restoredSnapshot);

    expect(await coordinator.removeQueueItem("playlist-item:11")).toBe(true);
    const reloadedSnapshot = loadPlaybackQueueSnapshot(() => storage);
    expect(reloadedSnapshot).toEqual({
      ...snapshot,
      displayedTracks: [snapshot.displayedTracks[1]],
    });
    if (reloadedSnapshot === null) return;

    const restartedCoordinator = new PlaybackQueueCoordinator(
      async (_trackId, canStart) =>
        canStart() ? { status: "started", playbackId: 1 } : { status: "cancelled" },
      () => {},
    );
    restartedCoordinator.restoreQueue(reloadedSnapshot);
    expect(restartedCoordinator.snapshot.displayedTracks).toEqual([snapshot.displayedTracks[1]]);
  });

  it("keeps the in-memory queue playable when local storage writes fail", async () => {
    const originalConsoleError = globalThis.console.error;
    let didLogStorageError = false;
    globalThis.console.error = () => {
      didLogStorageError = true;
    };
    try {
      const coordinator = new PlaybackQueueCoordinator(
        async (_trackId, canStart) =>
          canStart() ? { status: "started", playbackId: 1 } : { status: "cancelled" },
        createPlaybackQueueSnapshotWriter(null, () => {
          throw new Error("storage unavailable");
        }),
      );

      expect(await coordinator.replaceAndPlay(snapshot.displayedTracks, "playlist-item:11")).toBe(
        true,
      );
      expect(coordinator.snapshot.displayedTracks).toEqual(snapshot.displayedTracks);
      expect(coordinator.snapshot.currentRowKey).toBe("playlist-item:11");
      expect(didLogStorageError).toBe(true);
    } finally {
      globalThis.console.error = originalConsoleError;
    }
  });

  it("rejects corrupt snapshots, duplicate row keys, invalid current keys, and invalid numbers", () => {
    const duplicateRowKeySnapshot = {
      version: 1,
      ...snapshot,
      displayedTracks: [
        snapshot.displayedTracks[0],
        { ...snapshot.displayedTracks[1], rowKey: "playlist-item:11" },
      ],
    };
    const invalidCurrentKeySnapshot = { version: 1, ...snapshot, currentRowKey: "missing-row" };
    const invalidTrackNumberSnapshot = {
      version: 1,
      ...snapshot,
      displayedTracks: [{ ...snapshot.displayedTracks[0], trackId: Number.MAX_SAFE_INTEGER + 1 }],
      currentRowKey: "playlist-item:11",
    };
    const storage = createMemoryStorage();

    expect(parsePlaybackQueueSnapshot(duplicateRowKeySnapshot)).toBeNull();
    expect(parsePlaybackQueueSnapshot(invalidCurrentKeySnapshot)).toBeNull();
    expect(parsePlaybackQueueSnapshot(invalidTrackNumberSnapshot)).toBeNull();
    expect(
      parsePlaybackQueueSnapshot({
        version: 1,
        ...snapshot,
        displayedTracks: snapshot.displayedTracks.map((track) => ({ ...track, playbackId: 91 })),
      }),
    ).toBeNull();
    expect(parsePlaybackQueueSnapshot({ version: 1, ...snapshot, playbackHistory: [] })).toBeNull();

    storage.setItem(STORAGE_KEY, "not-json");
    const originalConsoleError = globalThis.console.error;
    globalThis.console.error = () => {};
    try {
      expect(loadPlaybackQueueSnapshot(() => storage)).toBeNull();
      expect(
        loadPlaybackQueueSnapshot(() => {
          throw new Error("storage unavailable");
        }),
      ).toBeNull();
    } finally {
      globalThis.console.error = originalConsoleError;
    }
  });
});

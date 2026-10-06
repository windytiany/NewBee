import { logger } from "@/shared/logging/logger";
import { describe, expect, it } from "bun:test";
import { PlaybackQueueCoordinator } from "@/features/playback/queue/coordinator";
import type { PlaybackQueueSnapshot } from "@/features/playback/queue/coordinator";
import {
  createPlaybackQueueSnapshotWriter,
  loadPlaybackQueueSnapshot,
  parsePlaybackQueueSnapshot,
  savePlaybackQueueSnapshot,
  type PlaybackQueuePersistenceSnapshot,
} from "@/features/playback/queue/persistence";

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

function createCoordinatorSnapshotWriter(
  initialSnapshot: PlaybackQueuePersistenceSnapshot | null,
  storageProvider: () => MemoryStorage,
) {
  const writeSnapshot = createPlaybackQueueSnapshotWriter(initialSnapshot, storageProvider);
  return (
    _snapshot: PlaybackQueueSnapshot,
    persistenceSnapshot: PlaybackQueuePersistenceSnapshot,
  ) => writeSnapshot(persistenceSnapshot);
}

const snapshot: PlaybackQueuePersistenceSnapshot = {
  displayedTracks: [
    { rowKey: "playlist-item:11", trackId: 7, title: "First", album: null, durationMs: 1200 },
    { rowKey: "album-track:7", trackId: 7, title: null, album: "Second", durationMs: null },
  ],
  currentRowKey: "album-track:7",
  nextRowKeys: [],
  shuffleEnabled: true,
  repeatOneEnabled: true,
};

describe("playback queue persistence", () => {
  it("round-trips ordered rows and modes, keeping duplicate track IDs distinct by rowKey", () => {
    const storage = createMemoryStorage();

    expect(savePlaybackQueueSnapshot(snapshot, () => storage)).toBe(true);
    expect(loadPlaybackQueueSnapshot(() => storage)).toEqual(snapshot);
    expect(JSON.parse(storage.values.get(STORAGE_KEY) ?? "null")).toEqual({
      version: 2,
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
      version: 2,
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
      createCoordinatorSnapshotWriter(null, () => storage),
    );
    coordinator.restoreQueue({
      displayedTracks: [],
      currentRowKey: null,
      nextRowKeys: [],
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
    const selectedRowKey = savedSnapshot.displayedTracks[1]?.rowKey;
    const removedRowKey = savedSnapshot.displayedTracks[0]?.rowKey;
    expect(selectedRowKey).toBeDefined();
    expect(removedRowKey).toBeDefined();
    if (!selectedRowKey || !removedRowKey) return;

    expect(await restoredCoordinator.playQueueItem(selectedRowKey)).toBe(true);
    expect(restoredCoordinator.snapshot.currentRowKey).toBe(selectedRowKey);
    expect(await restoredCoordinator.removeQueueItems([removedRowKey])).toEqual({
      status: "removed",
    });

    const restoredRows = restoredCoordinator.snapshot.displayedTracks;
    expect(restoredRows).toHaveLength(2);
    expect(restoredRows.map((track) => track.trackId)).toEqual([7, 7]);
    expect(restoredRows.map((track) => track.rowKey)).toContain(selectedRowKey);
    expect(new Set(restoredRows.map((track) => track.rowKey)).size).toBe(2);
  });

  it("restores explicit next priority ahead of shuffled rows despite a matching row-key substring", async () => {
    const storage = createMemoryStorage();
    let nextPlaybackId = 0;
    const options = { random: () => 0 };
    const coordinator = new PlaybackQueueCoordinator(
      async (_trackId, canStart) =>
        canStart() ? { status: "started", playbackId: ++nextPlaybackId } : { status: "cancelled" },
      createCoordinatorSnapshotWriter(null, () => storage),
      options,
    );
    coordinator.restoreQueue({
      displayedTracks: [
        {
          rowKey: "queue-next:ordinary-row",
          trackId: 2,
          title: "ordinary",
          album: null,
          durationMs: null,
        },
        { rowKey: "regular-row", trackId: 6, title: "regular", album: null, durationMs: null },
      ],
      currentRowKey: null,
      nextRowKeys: [],
      shuffleEnabled: true,
      repeatOneEnabled: false,
    });
    await coordinator.addToNext({ trackId: 3, title: "A", album: null, durationMs: null });
    await coordinator.addToNext({ trackId: 4, title: "B", album: null, durationMs: null });
    await coordinator.addToQueueEnd({ trackId: 5, title: "tail", album: null, durationMs: null });

    const savedSnapshot = loadPlaybackQueueSnapshot(() => storage);
    expect(savedSnapshot).not.toBeNull();
    if (!savedSnapshot) return;

    const savedNextRowKeys = new Set(savedSnapshot.nextRowKeys);
    expect(
      savedSnapshot.displayedTracks
        .filter((track) => [3, 4].includes(track.trackId))
        .every((track) => savedNextRowKeys.has(track.rowKey)),
    ).toBe(true);
    expect(savedNextRowKeys.has("queue-next:ordinary-row")).toBe(false);

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
    for (let index = 0; index < 5; index += 1) {
      expect(await restoredCoordinator.playNext()).toBe(true);
    }
    expect(attempts).toEqual([4, 3, 6, 5, 2]);
  });

  it("persists mode changes and successful automatic track advances", async () => {
    const storage = createMemoryStorage();
    let nextPlaybackId = 0;
    const coordinator = new PlaybackQueueCoordinator(
      async (_trackId, canStart) =>
        canStart() ? { status: "started", playbackId: ++nextPlaybackId } : { status: "cancelled" },
      createCoordinatorSnapshotWriter(null, () => storage),
    );
    const queue = snapshot.displayedTracks;
    coordinator.restoreQueue({
      displayedTracks: [],
      currentRowKey: null,
      nextRowKeys: [],
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
      createCoordinatorSnapshotWriter(restoredSnapshot, () => storage),
    );
    coordinator.restoreQueue(restoredSnapshot);

    expect(await coordinator.removeQueueItems(["playlist-item:11"])).toEqual({ status: "removed" });
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
    const originalConsoleError = logger.warn;
    let didLogStorageError = false;
    logger.warn = () => {
      didLogStorageError = true;
    };
    try {
      const coordinator = new PlaybackQueueCoordinator(
        async (_trackId, canStart) =>
          canStart() ? { status: "started", playbackId: 1 } : { status: "cancelled" },
        createCoordinatorSnapshotWriter(null, () => {
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
      logger.warn = originalConsoleError;
    }
  });

  it("rejects legacy and corrupt snapshots, invalid priorities, duplicate keys, and invalid numbers", () => {
    const legacySnapshot = {
      version: 1,
      displayedTracks: snapshot.displayedTracks,
      currentRowKey: snapshot.currentRowKey,
      shuffleEnabled: snapshot.shuffleEnabled,
      repeatOneEnabled: snapshot.repeatOneEnabled,
    };
    const duplicateRowKeySnapshot = {
      version: 2,
      ...snapshot,
      displayedTracks: [
        snapshot.displayedTracks[0],
        { ...snapshot.displayedTracks[1], rowKey: "playlist-item:11" },
      ],
    };
    const invalidCurrentKeySnapshot = { version: 2, ...snapshot, currentRowKey: "missing-row" };
    const invalidTrackNumberSnapshot = {
      version: 2,
      ...snapshot,
      displayedTracks: [{ ...snapshot.displayedTracks[0], trackId: Number.MAX_SAFE_INTEGER + 1 }],
      currentRowKey: "playlist-item:11",
    };
    const storage = createMemoryStorage();

    expect(parsePlaybackQueueSnapshot(legacySnapshot)).toBeNull();
    expect(parsePlaybackQueueSnapshot(duplicateRowKeySnapshot)).toBeNull();
    expect(parsePlaybackQueueSnapshot(invalidCurrentKeySnapshot)).toBeNull();
    expect(parsePlaybackQueueSnapshot(invalidTrackNumberSnapshot)).toBeNull();
    expect(
      parsePlaybackQueueSnapshot({ version: 2, ...snapshot, nextRowKeys: ["missing-row"] }),
    ).toBeNull();
    expect(
      parsePlaybackQueueSnapshot({
        version: 2,
        ...snapshot,
        nextRowKeys: ["playlist-item:11", "playlist-item:11"],
      }),
    ).toBeNull();
    expect(
      parsePlaybackQueueSnapshot({
        version: 2,
        ...snapshot,
        displayedTracks: snapshot.displayedTracks.map((track) => ({ ...track, playbackId: 91 })),
      }),
    ).toBeNull();
    expect(parsePlaybackQueueSnapshot({ version: 2, ...snapshot, playbackHistory: [] })).toBeNull();

    storage.setItem(STORAGE_KEY, "not-json");
    const originalConsoleError = logger.warn;
    logger.warn = () => {};
    try {
      expect(loadPlaybackQueueSnapshot(() => storage)).toBeNull();
      expect(
        loadPlaybackQueueSnapshot(() => {
          throw new Error("storage unavailable");
        }),
      ).toBeNull();
    } finally {
      logger.warn = originalConsoleError;
    }
  });
});

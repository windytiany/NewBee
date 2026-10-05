import type { PlaybackDisplayTrack } from "@/features/playback/types";

const PLAYBACK_QUEUE_STORAGE_KEY = "newbee.playback-queue";
const PLAYBACK_QUEUE_SNAPSHOT_VERSION = 2;

export type PlaybackQueuePersistenceSnapshot = {
  displayedTracks: readonly PlaybackDisplayTrack[];
  currentRowKey: string | null;
  nextRowKeys: readonly string[];
  shuffleEnabled: boolean;
  repeatOneEnabled: boolean;
};

export type PlaybackQueueStorage = Pick<Storage, "getItem" | "setItem">;
type StorageProvider = () => PlaybackQueueStorage;
type PersistableQueueState = Pick<
  PlaybackQueuePersistenceSnapshot,
  "displayedTracks" | "currentRowKey" | "nextRowKeys" | "shuffleEnabled" | "repeatOneEnabled"
>;

export const EMPTY_PLAYBACK_QUEUE_SNAPSHOT: PlaybackQueuePersistenceSnapshot = {
  displayedTracks: [],
  currentRowKey: null,
  nextRowKeys: [],
  shuffleEnabled: false,
  repeatOneEnabled: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]) {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isPlaybackDisplayTrack(value: unknown): value is PlaybackDisplayTrack {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["trackId", "rowKey", "title", "album", "durationMs"])
  ) {
    return false;
  }

  return (
    typeof value.trackId === "number" &&
    Number.isSafeInteger(value.trackId) &&
    value.trackId > 0 &&
    typeof value.rowKey === "string" &&
    value.rowKey.trim().length > 0 &&
    (value.title === null || typeof value.title === "string") &&
    (value.album === null || typeof value.album === "string") &&
    (value.durationMs === null ||
      (typeof value.durationMs === "number" &&
        Number.isSafeInteger(value.durationMs) &&
        value.durationMs >= 0))
  );
}

export function parsePlaybackQueueSnapshot(
  value: unknown,
): PlaybackQueuePersistenceSnapshot | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "displayedTracks",
      "currentRowKey",
      "nextRowKeys",
      "shuffleEnabled",
      "repeatOneEnabled",
    ]) ||
    value.version !== PLAYBACK_QUEUE_SNAPSHOT_VERSION ||
    !Array.isArray(value.displayedTracks) ||
    !Array.isArray(value.nextRowKeys) ||
    typeof value.shuffleEnabled !== "boolean" ||
    typeof value.repeatOneEnabled !== "boolean" ||
    (value.currentRowKey !== null && typeof value.currentRowKey !== "string")
  ) {
    return null;
  }

  const displayedTracks: PlaybackDisplayTrack[] = [];
  const rowKeys = new Set<string>();
  for (const track of value.displayedTracks) {
    if (!isPlaybackDisplayTrack(track) || rowKeys.has(track.rowKey)) return null;
    rowKeys.add(track.rowKey);
    displayedTracks.push({ ...track });
  }

  if (value.currentRowKey !== null && !rowKeys.has(value.currentRowKey)) return null;

  const nextRowKeys: string[] = [];
  const uniqueNextRowKeys = new Set<string>();
  for (const rowKey of value.nextRowKeys) {
    if (
      typeof rowKey !== "string" ||
      rowKey.trim().length === 0 ||
      !rowKeys.has(rowKey) ||
      uniqueNextRowKeys.has(rowKey)
    ) {
      return null;
    }
    uniqueNextRowKeys.add(rowKey);
    nextRowKeys.push(rowKey);
  }

  return {
    displayedTracks,
    currentRowKey: value.currentRowKey,
    nextRowKeys,
    shuffleEnabled: value.shuffleEnabled,
    repeatOneEnabled: value.repeatOneEnabled,
  };
}

export function loadPlaybackQueueSnapshot(
  storageProvider: StorageProvider = () => globalThis.localStorage,
): PlaybackQueuePersistenceSnapshot | null {
  let serializedSnapshot: string | null;
  let storedSnapshot: unknown;
  try {
    serializedSnapshot = storageProvider().getItem(PLAYBACK_QUEUE_STORAGE_KEY);
    if (serializedSnapshot === null) return null;
    storedSnapshot = JSON.parse(serializedSnapshot);
  } catch (error) {
    globalThis.console.error("Could not read saved playback queue; using an empty queue.", error);
    return null;
  }

  const snapshot = parsePlaybackQueueSnapshot(storedSnapshot);
  if (snapshot === null) {
    globalThis.console.error("Saved playback queue is invalid; using an empty queue.");
  }
  return snapshot;
}

export function savePlaybackQueueSnapshot(
  snapshot: PlaybackQueuePersistenceSnapshot,
  storageProvider: StorageProvider = () => globalThis.localStorage,
): boolean {
  try {
    storageProvider().setItem(
      PLAYBACK_QUEUE_STORAGE_KEY,
      JSON.stringify({
        version: PLAYBACK_QUEUE_SNAPSHOT_VERSION,
        ...copyPersistableQueueState(snapshot),
      }),
    );
    return true;
  } catch (error) {
    globalThis.console.error("Could not save playback queue.", error);
    return false;
  }
}

function copyPersistableQueueState(state: PersistableQueueState): PlaybackQueuePersistenceSnapshot {
  return {
    displayedTracks: state.displayedTracks.map((track) => ({
      trackId: track.trackId,
      rowKey: track.rowKey,
      title: track.title,
      album: track.album,
      durationMs: track.durationMs,
    })),
    currentRowKey: state.currentRowKey,
    nextRowKeys: [...state.nextRowKeys],
    shuffleEnabled: state.shuffleEnabled,
    repeatOneEnabled: state.repeatOneEnabled,
  };
}

function serializeSnapshot(snapshot: PlaybackQueuePersistenceSnapshot) {
  return JSON.stringify({ version: PLAYBACK_QUEUE_SNAPSHOT_VERSION, ...snapshot });
}

export function createPlaybackQueueSnapshotWriter(
  initialSnapshot: PlaybackQueuePersistenceSnapshot | null,
  storageProvider: StorageProvider = () => globalThis.localStorage,
) {
  let lastObservedSerialization = serializeSnapshot(
    copyPersistableQueueState(initialSnapshot ?? EMPTY_PLAYBACK_QUEUE_SNAPSHOT),
  );
  let lastWriteSucceeded = true;

  return (state: PersistableQueueState) => {
    const snapshot = copyPersistableQueueState(state);
    const serializedSnapshot = serializeSnapshot(snapshot);
    if (serializedSnapshot === lastObservedSerialization && lastWriteSucceeded) return;

    lastObservedSerialization = serializedSnapshot;
    lastWriteSucceeded = savePlaybackQueueSnapshot(snapshot, storageProvider);
  };
}

// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { describe, expect, it } from "bun:test";
import {
  PlaybackQueueCoordinator,
  type PlaybackQueueSnapshot,
  type QueuePlaybackAttempt,
} from "@/composables/playbackQueueCoordinator";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";

type AttemptPlayback = (trackId: number, canStart: () => boolean) => Promise<QueuePlaybackAttempt>;

type HarnessOptions = {
  random?: () => number;
  failedTrackIds?: number[];
  attemptPlayback?: AttemptPlayback;
};

function tracks(...entries: [rowKey: string, trackId: number][]): PlaybackDisplayTrack[] {
  return entries.map(([rowKey, trackId]) => ({
    rowKey,
    trackId,
    title: rowKey,
    album: null,
    durationMs: null,
  }));
}

function createHarness(options: HarnessOptions = {}) {
  const attempts: number[] = [];
  const stoppedPlaybackIds: number[] = [];
  const failedTrackIds = new Set(options.failedTrackIds ?? []);
  let nextPlaybackId = 0;
  let latestSnapshot: PlaybackQueueSnapshot | null = null;

  const attemptPlayback: AttemptPlayback = async (trackId, canStart) => {
    attempts.push(trackId);
    if (options.attemptPlayback) return options.attemptPlayback(trackId, canStart);
    if (!canStart()) return { status: "cancelled" };
    if (failedTrackIds.has(trackId)) {
      return {
        status: "failed",
        failure: { kind: "playback-failed", message: "不可播放" },
      };
    }
    return { status: "started", playbackId: ++nextPlaybackId };
  };

  const coordinator = new PlaybackQueueCoordinator(
    attemptPlayback,
    (snapshot) => {
      latestSnapshot = snapshot;
    },
    {
      random: options.random,
      stopPlayback: async (playbackId) => {
        stoppedPlaybackIds.push(playbackId);
        return true;
      },
    },
  );

  return {
    coordinator,
    attempts,
    stoppedPlaybackIds,
    get snapshot() {
      return latestSnapshot ?? coordinator.snapshot;
    },
  };
}

function endedObservation(playbackId: number, trackId: number) {
  return {
    status: {
      hasAudio: true,
      isPlaying: false,
      hasEnded: true,
      playbackId,
      positionMs: 100,
      durationMs: 100,
    },
    currentPlaybackId: playbackId,
    currentTrackId: trackId,
    isCommandPending: false,
    isSeeking: false,
  };
}

describe("PlaybackQueueCoordinator manual navigation", () => {
  it("moves through sequential history despite repeat-one and stops at the end without wrapping", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2], ["c", 3]), "a");

    expect(harness.snapshot.canPlayPrevious).toBe(false);
    expect(await coordinator.playPrevious()).toBe(false);
    expect(harness.attempts).toEqual([1]);

    coordinator.setRepeatOneEnabled(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("b");
    expect(await coordinator.playPrevious()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("a");
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("b");
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("c");

    expect(harness.snapshot.canPlayNext).toBe(true);
    expect(await coordinator.playNext()).toBe(false);
    expect(harness.stoppedPlaybackIds).toEqual([5]);
    expect(harness.snapshot.currentRowKey).toBeNull();
    expect(harness.snapshot.canPlayNext).toBe(false);
    expect(harness.attempts).toEqual([1, 2, 1, 2, 3]);
  });

  it("uses successful shuffle history for previous and exhausts history before unused candidates", async () => {
    const harness = createHarness({ random: () => 0 });
    const { coordinator } = harness;
    coordinator.setShuffleEnabled(true);
    await coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5]), "a");

    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("c");
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("d");
    expect(await coordinator.playPrevious()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("c");
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("d");
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("e");
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("b");
    expect(harness.attempts).toEqual([1, 3, 4, 3, 4, 5, 2]);
  });

  it("continues forward after a target fails and reports the failed track", async () => {
    const harness = createHarness({ failedTrackIds: [2] });
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2], ["c", 3]), "a");

    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("c");
    expect(harness.snapshot.queuePlaybackError).toContain("b：播放失败：不可播放");
    expect(harness.attempts).toEqual([1, 2, 3]);
  });

  it("tracks repeated track IDs by rowKey", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(
      tracks(["first-row", 7], ["second-row", 7], ["third-row", 8]),
      "first-row",
    );

    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("second-row");
    expect(await coordinator.playPrevious()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("first-row");
    expect(harness.attempts).toEqual([7, 7, 7]);
  });

  it("prunes removed history and resets it when a queue item or replacement starts a new round", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2], ["c", 3], ["d", 4]), "a");
    await coordinator.playNext();
    await coordinator.playNext();
    await coordinator.playPrevious();

    expect(await coordinator.removeQueueItem("c")).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("d");
    expect(await coordinator.playPrevious()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("b");
    expect(await coordinator.removeQueueItem("a")).toBe(true);
    expect(harness.snapshot.canPlayPrevious).toBe(false);
    expect(await coordinator.playPrevious()).toBe(false);

    expect(await coordinator.playQueueItem("d")).toBe(true);
    expect(harness.snapshot.canPlayPrevious).toBe(false);
    expect(await coordinator.replaceAndPlay(tracks(["x", 10], ["y", 11]), "x")).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("x");
    expect(harness.snapshot.canPlayPrevious).toBe(false);
  });

  it("keeps natural repeat-one separate from manual navigation history", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2]), "a");
    coordinator.setRepeatOneEnabled(true);

    await coordinator.observePlaybackStatus(endedObservation(1, 1));

    expect(harness.attempts).toEqual([1, 1]);
    expect(harness.snapshot.currentRowKey).toBe("a");
    expect(harness.snapshot.canPlayPrevious).toBe(false);
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("b");
  });

  it("restores the queue and modes without treating the saved row as active playback", async () => {
    const harness = createHarness();
    const restoredTracks = tracks(["first-row", 7], ["selected-row", 7], ["next-row", 8]);

    harness.coordinator.restoreQueue({
      displayedTracks: restoredTracks,
      currentRowKey: "selected-row",
      shuffleEnabled: true,
      repeatOneEnabled: true,
    });

    expect(harness.snapshot.displayedTracks).toEqual(restoredTracks);
    expect(harness.snapshot.currentRowKey).toBe("selected-row");
    expect(harness.snapshot.shuffleEnabled).toBe(true);
    expect(harness.snapshot.repeatOneEnabled).toBe(true);
    expect(harness.attempts).toEqual([]);
    expect(
      await harness.coordinator.observePlaybackStatus({
        ...endedObservation(99, 7),
        currentPlaybackId: null,
      }),
    ).toBe(false);
    expect(harness.attempts).toEqual([]);
  });

  it("starts the first restored playback from the saved row key", async () => {
    const harness = createHarness();
    const restoredTracks = tracks(["first-row", 7], ["selected-row", 7], ["next-row", 8]);
    harness.coordinator.restoreQueue({
      displayedTracks: restoredTracks,
      currentRowKey: "selected-row",
      shuffleEnabled: false,
      repeatOneEnabled: true,
    });

    expect(await harness.coordinator.playQueueItem("selected-row")).toBe(true);
    expect(harness.attempts).toEqual([7]);
    expect(harness.snapshot.currentRowKey).toBe("selected-row");
    expect(harness.snapshot.repeatOneEnabled).toBe(true);
  });

  it("discards a late automatic start and retries the candidate for the latest manual operation", async () => {
    let releaseFirstAttempt!: (result: QueuePlaybackAttempt) => void;
    let notifyFirstAttemptStarted!: () => void;
    const firstAttemptStarted = new Promise<void>((resolve) => {
      notifyFirstAttemptStarted = resolve;
    });
    const attempts: number[] = [];
    const stalePlaybackIds: number[] = [];
    let nextPlaybackId = 0;
    let deferFirstCandidate = true;
    const snapshots: PlaybackQueueSnapshot[] = [];
    const coordinator = new PlaybackQueueCoordinator(
      async (trackId, canStart) => {
        attempts.push(trackId);
        if (trackId === 2 && deferFirstCandidate) {
          deferFirstCandidate = false;
          notifyFirstAttemptStarted();
          return new Promise<QueuePlaybackAttempt>((resolve) => {
            releaseFirstAttempt = resolve;
          });
        }
        if (!canStart()) return { status: "cancelled" };
        return { status: "started", playbackId: ++nextPlaybackId };
      },
      (snapshot) => {
        snapshots.push(snapshot);
      },
      { stopStalePlayback: async (playbackId) => void stalePlaybackIds.push(playbackId) },
    );
    await coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2]), "a");

    const automaticAdvance = coordinator.observePlaybackStatus(endedObservation(1, 1));
    await firstAttemptStarted;
    const manualAdvance = coordinator.playNext();
    releaseFirstAttempt({ status: "started", playbackId: 100 });
    await Promise.all([automaticAdvance, manualAdvance]);

    expect(snapshots[snapshots.length - 1]?.currentRowKey).toBe("b");
    expect(attempts).toEqual([1, 2, 2]);
    expect(stalePlaybackIds).toEqual([100]);
  });
});

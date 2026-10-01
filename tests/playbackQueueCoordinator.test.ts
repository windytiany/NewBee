// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { describe, expect, it } from "bun:test";
import {
  PlaybackQueueCoordinator,
  type PlaybackQueueSnapshot,
  type QueuePlaybackAttempt,
} from "@/playback/queue/coordinator";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";

type AttemptPlayback = (trackId: number, canStart: () => boolean) => Promise<QueuePlaybackAttempt>;

type HarnessOptions = {
  random?: () => number;
  failedTrackIds?: number[];
  attemptPlayback?: AttemptPlayback;
  stopPlayback?: (playbackId: number) => Promise<boolean>;
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
        return options.stopPlayback ? options.stopPlayback(playbackId) : true;
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

describe("PlaybackQueueCoordinator manual navigation", () => {
  it("uses queue order for previous when starting in the middle", async () => {
    const harness = createHarness();
    await harness.coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2], ["c", 3]), "b");
    expect(harness.snapshot.canPlayPrevious).toBe(true);
    expect(await harness.coordinator.playPrevious()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("a");
    expect(harness.snapshot.canPlayPrevious).toBe(false);
    expect(await harness.coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("b");
    expect(harness.attempts).toEqual([2, 1, 2]);
  });

  it("disables next on the last row without clearing current playback", async () => {
    const harness = createHarness();
    await harness.coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2]), "b");
    expect(harness.snapshot.canPlayNext).toBe(false);
    expect(await harness.coordinator.playNext()).toBe(false);
    expect(harness.snapshot.currentRowKey).toBe("b");
    expect(harness.stoppedPlaybackIds).toEqual([]);
  });

  it("switches from shuffle history to queue order when shuffle is disabled", async () => {
    const harness = createHarness({ random: () => 0 });
    harness.coordinator.setShuffleEnabled(true);
    await harness.coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2], ["c", 3]), "b");
    expect(harness.snapshot.canPlayPrevious).toBe(false);
    harness.coordinator.setShuffleEnabled(false);
    expect(harness.snapshot.canPlayPrevious).toBe(true);
    expect(await harness.coordinator.playPrevious()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("a");
    expect(await harness.coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("b");
  });
  it("moves through queue order despite repeat-one and disables next at the end without wrapping", async () => {
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

    expect(harness.snapshot.canPlayNext).toBe(false);
    expect(await coordinator.playNext()).toBe(false);
    expect(harness.stoppedPlaybackIds).toEqual([]);
    expect(harness.snapshot.currentRowKey).toBe("c");
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
    expect(harness.snapshot.canPlayNext).toBe(false);
    expect(await coordinator.playNext()).toBe(false);
    expect(harness.snapshot.currentRowKey).toBe("b");
  });

  it("skips failed previous rows in queue order and preserves duplicate track IDs", async () => {
    const harness = createHarness({ failedTrackIds: [2] });
    await harness.coordinator.replaceAndPlay(
      tracks(["first", 7], ["failed", 2], ["last", 7]),
      "last",
    );
    expect(await harness.coordinator.playPrevious()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("first");
    expect(harness.snapshot.canPlayPrevious).toBe(false);
    expect(harness.attempts).toEqual([7, 2, 7]);
    expect(await harness.coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("last");
    expect(harness.snapshot.canPlayNext).toBe(false);
  });

  it("disabling shuffle navigates by queue position rather than successful history", async () => {
    const harness = createHarness({ random: () => 0 });
    harness.coordinator.setShuffleEnabled(true);
    await harness.coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2], ["c", 3], ["d", 4]), "a");
    await harness.coordinator.playNext();
    expect(harness.snapshot.currentRowKey).toBe("c");
    harness.coordinator.setShuffleEnabled(false);
    await harness.coordinator.playPrevious();
    expect(harness.snapshot.currentRowKey).toBe("b");
    await harness.coordinator.playNext();
    expect(harness.snapshot.currentRowKey).toBe("c");
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

  it("prioritizes explicit next items without treating row-key text as scheduling state", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(
      tracks(["current", 1], ["waiting", 2], ["queue-next:ordinary-row", 5]),
      "current",
    );

    expect(
      await coordinator.addToNext({
        trackId: 3,
        title: "A",
        album: null,
        durationMs: null,
      }),
    ).toBe(true);
    expect(
      await coordinator.addToNext({
        trackId: 4,
        title: "B",
        album: null,
        durationMs: null,
      }),
    ).toBe(true);

    expect(harness.snapshot.displayedTracks.map((track) => track.trackId)).toEqual([1, 4, 3, 2, 5]);
    const addedRows = harness.snapshot.displayedTracks.filter((track) =>
      [3, 4].includes(track.trackId),
    );
    expect(addedRows.every((track) => !track.rowKey.startsWith("queue-next:"))).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("current");
    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.attempts).toEqual([1, 4, 3, 2, 5]);
  });

  it("keeps a batch of next additions in visible order for playback", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["current", 1], ["waiting", 2]), "current");

    expect(
      await coordinator.addTracksToNext([
        { trackId: 3, title: "A", album: null, durationMs: null },
        { trackId: 4, title: "B", album: null, durationMs: null },
        { trackId: 5, title: "C", album: null, durationMs: null },
      ]),
    ).toBe(true);
    expect(harness.snapshot.displayedTracks.map((track) => track.trackId)).toEqual([1, 3, 4, 5, 2]);

    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.attempts).toEqual([1, 3, 4, 5]);
  });

  it("appends a batch to the visible queue tail in input order", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["current", 1], ["waiting", 2]), "current");

    expect(
      await coordinator.addTracksToQueueEnd([
        { trackId: 3, title: "A", album: null, durationMs: null },
        { trackId: 4, title: "B", album: null, durationMs: null },
        { trackId: 5, title: "C", album: null, durationMs: null },
      ]),
    ).toBe(true);
    expect(harness.snapshot.displayedTracks.map((track) => track.trackId)).toEqual([1, 2, 3, 4, 5]);

    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.attempts).toEqual([1, 2, 3, 4, 5]);
  });

  it("appends without interrupting and shuffles the new tail item with pending candidates", async () => {
    const harness = createHarness({ random: () => 0 });
    const { coordinator } = harness;
    coordinator.setShuffleEnabled(true);
    await coordinator.replaceAndPlay(tracks(["current", 1], ["b", 2], ["c", 3]), "current");

    expect(
      await coordinator.addToQueueEnd({
        trackId: 4,
        title: "tail",
        album: null,
        durationMs: null,
      }),
    ).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("current");
    expect(harness.snapshot.displayedTracks.map((track) => track.trackId)).toEqual([1, 2, 3, 4]);
    expect(harness.attempts).toEqual([1]);

    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.attempts).toEqual([1, 2, 4, 3]);
  });

  it("puts next additions before forward history after previous navigation", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2], ["c", 3], ["d", 4]), "a");
    await coordinator.playNext();
    await coordinator.playNext();
    expect(await coordinator.playPrevious()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("b");

    await coordinator.addToNext({ trackId: 5, title: "A", album: null, durationMs: null });
    await coordinator.addToNext({ trackId: 6, title: "B", album: null, durationMs: null });

    expect(harness.snapshot.displayedTracks.map((track) => track.trackId)).toEqual([
      1, 2, 6, 5, 3, 4,
    ]);
    expect(await coordinator.observePlaybackState(4, false, true)).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.attempts).toEqual([1, 2, 3, 2, 6, 5, 3]);
  });

  it("removes every queued row for a track and advances after stopping its current row", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(
      tracks(
        ["current-duplicate", 7],
        ["queued-duplicate-a", 7],
        ["other", 8],
        ["queued-duplicate-b", 7],
      ),
      "current-duplicate",
    );

    expect(await coordinator.removeTrackFromQueue(7)).toEqual({ status: "removed" });
    expect(harness.snapshot.displayedTracks.map((track) => track.trackId)).toEqual([8]);
    expect(harness.snapshot.currentRowKey).toBe("other");
    expect(harness.stoppedPlaybackIds).toEqual([1]);
    expect(harness.attempts).toEqual([7, 8]);
    expect(await coordinator.removeTrackFromQueue(7)).toEqual({ status: "not-found" });
  });

  it("removes a multi-row selection with the current row using one stop and one advance", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(
      tracks(["current", 1], ["selected", 2], ["next", 3], ["tail", 4]),
      "current",
    );

    expect(await coordinator.removeQueueItems(["current", "selected"])).toEqual({
      status: "removed",
    });
    expect(harness.snapshot.displayedTracks.map((track) => track.rowKey)).toEqual(["next", "tail"]);
    expect(harness.snapshot.currentRowKey).toBe("next");
    expect(harness.stoppedPlaybackIds).toEqual([1]);
    expect(harness.attempts).toEqual([1, 3]);
  });

  it("preserves stop failure semantics when a batch contains the current row", async () => {
    const harness = createHarness({
      stopPlayback: async () => {
        throw new Error("device busy");
      },
    });
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(
      tracks(["current", 1], ["selected", 2], ["next", 3]),
      "current",
    );

    expect(await coordinator.removeQueueItems(["current", "selected"])).toEqual({
      status: "stop-failed",
      message: "device busy",
    });
    expect(harness.snapshot.displayedTracks.map((track) => track.rowKey)).toEqual(["next"]);
    expect(harness.snapshot.currentRowKey).toBeNull();
    expect(harness.stoppedPlaybackIds).toEqual([1]);
    expect(harness.attempts).toEqual([1]);
  });

  it("removes a non-current track without stopping or advancing current playback", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(
      tracks(["current", 1], ["removed", 2], ["next", 3]),
      "current",
    );

    expect(await coordinator.removeTrackFromQueue(2)).toEqual({ status: "removed" });
    expect(harness.snapshot.displayedTracks.map((track) => track.trackId)).toEqual([1, 3]);
    expect(harness.snapshot.currentRowKey).toBe("current");
    expect(harness.stoppedPlaybackIds).toEqual([]);
    expect(harness.attempts).toEqual([1]);
  });

  it("reports stop failure without advancing to the next track", async () => {
    const harness = createHarness({
      stopPlayback: async () => {
        throw new Error("device busy");
      },
    });
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["current", 1], ["next", 2]), "current");

    expect(await coordinator.removeTrackFromQueue(1)).toEqual({
      status: "stop-failed",
      message: "device busy",
    });
    expect(harness.snapshot.displayedTracks.map((track) => track.trackId)).toEqual([2]);
    expect(harness.snapshot.currentRowKey).toBeNull();
    expect(harness.attempts).toEqual([1]);
  });

  it("distinguishes an unconfirmed stop from a stop failure", async () => {
    const harness = createHarness({ stopPlayback: async () => false });
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["current", 1], ["next", 2]), "current");

    expect(await coordinator.removeTrackFromQueue(1)).toEqual({ status: "stop-unconfirmed" });
    expect(harness.attempts).toEqual([1]);
  });

  it("reports queue removal superseded by a newer playback operation", async () => {
    let releaseStop!: (canAdvance: boolean) => void;
    let notifyStopStarted!: () => void;
    const stopStarted = new Promise<void>((resolve) => {
      notifyStopStarted = resolve;
    });
    const harness = createHarness({
      stopPlayback: async () => {
        notifyStopStarted();
        return new Promise<boolean>((resolve) => {
          releaseStop = resolve;
        });
      },
    });
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["current", 1], ["next", 2]), "current");

    const removal = coordinator.removeTrackFromQueue(1);
    await stopStarted;
    const newerPlayback = coordinator.playQueueItem("next");
    releaseStop(true);

    expect(await removal).toEqual({ status: "superseded" });
    expect(await newerPlayback).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("next");
    expect(harness.attempts).toEqual([1, 2]);
  });

  it("rejects unexpected queue-state errors instead of reporting cleanup success", async () => {
    let shouldThrow = false;
    const coordinator = new PlaybackQueueCoordinator(
      async (trackId) => ({ status: "started", playbackId: trackId }),
      (snapshot) => {
        if (shouldThrow && snapshot.currentRowKey === null) {
          throw new Error("queue persistence failed");
        }
      },
      { stopPlayback: async () => true },
    );
    await coordinator.replaceAndPlay(tracks(["current", 1], ["next", 2]), "current");
    shouldThrow = true;

    await expect(coordinator.removeTrackFromQueue(1)).rejects.toThrow("queue persistence failed");
  });

  it("prunes removed history and resets it when a queue item or replacement starts a new round", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2], ["c", 3], ["d", 4]), "a");
    await coordinator.playNext();
    await coordinator.playNext();
    await coordinator.playPrevious();

    expect(await coordinator.removeQueueItems(["c"])).toEqual({ status: "removed" });
    expect(await coordinator.playNext()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("d");
    expect(await coordinator.playPrevious()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("b");
    expect(await coordinator.removeQueueItems(["a"])).toEqual({ status: "removed" });
    expect(harness.snapshot.canPlayPrevious).toBe(false);
    expect(await coordinator.playPrevious()).toBe(false);

    expect(await coordinator.playQueueItem("d")).toBe(true);
    expect(harness.snapshot.canPlayPrevious).toBe(true);
    expect(await coordinator.playPrevious()).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("b");
    expect(await coordinator.replaceAndPlay(tracks(["x", 10], ["y", 11]), "x")).toBe(true);
    expect(harness.snapshot.currentRowKey).toBe("x");
    expect(harness.snapshot.canPlayPrevious).toBe(false);
  });

  it("keeps natural repeat-one separate from manual navigation history", async () => {
    const harness = createHarness();
    const { coordinator } = harness;
    await coordinator.replaceAndPlay(tracks(["a", 1], ["b", 2]), "a");
    await coordinator.addToNext({ trackId: 3, title: "next", album: null, durationMs: null });
    coordinator.setRepeatOneEnabled(true);

    await coordinator.observePlaybackState(1, false, true);

    expect(harness.attempts).toEqual([1, 1]);
    expect(harness.snapshot.currentRowKey).toBe("a");
    expect(harness.snapshot.canPlayPrevious).toBe(false);
    expect(await coordinator.playNext()).toBe(true);
    expect(
      harness.snapshot.displayedTracks.find(
        (track) => track.rowKey === harness.snapshot.currentRowKey,
      )?.trackId,
    ).toBe(3);
  });

  it("restores the queue and modes without treating the saved row as active playback", async () => {
    const harness = createHarness();
    const restoredTracks = tracks(["first-row", 7], ["selected-row", 7], ["next-row", 8]);

    harness.coordinator.restoreQueue({
      displayedTracks: restoredTracks,
      currentRowKey: "selected-row",
      nextRowKeys: [],
      shuffleEnabled: true,
      repeatOneEnabled: true,
    });

    expect(harness.snapshot.displayedTracks).toEqual(restoredTracks);
    expect(harness.snapshot.currentRowKey).toBe("selected-row");
    expect(harness.snapshot.shuffleEnabled).toBe(true);
    expect(harness.snapshot.repeatOneEnabled).toBe(true);
    expect(harness.attempts).toEqual([]);
  });

  it("serializes a queue addition behind an in-flight playback start", async () => {
    let releaseFirstStart!: (result: QueuePlaybackAttempt) => void;
    let notifyFirstStart!: () => void;
    const firstStart = new Promise<void>((resolve) => {
      notifyFirstStart = resolve;
    });
    const attempts: number[] = [];
    let nextPlaybackId = 0;
    const coordinator = new PlaybackQueueCoordinator(
      async (trackId, canStart) => {
        attempts.push(trackId);
        if (trackId === 1) {
          notifyFirstStart();
          return new Promise<QueuePlaybackAttempt>((resolve) => {
            releaseFirstStart = resolve;
          });
        }
        return canStart()
          ? { status: "started", playbackId: ++nextPlaybackId }
          : { status: "cancelled" };
      },
      () => {},
    );
    const starting = coordinator.replaceAndPlay(tracks(["current", 1], ["waiting", 2]), "current");
    await firstStart;
    const adding = coordinator.addToNext({
      trackId: 3,
      title: "new",
      album: null,
      durationMs: null,
    });

    releaseFirstStart({ status: "started", playbackId: 1 });

    expect(await starting).toBe(true);
    expect(await adding).toBe(true);
    expect(coordinator.snapshot.displayedTracks.map((track) => track.trackId)).toEqual([1, 3, 2]);
    expect(coordinator.snapshot.currentRowKey).toBe("current");
    expect(await coordinator.playNext()).toBe(true);
    expect(attempts).toEqual([1, 3]);
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

    const automaticAdvance = coordinator.observePlaybackState(1, false, true);
    await firstAttemptStarted;
    const manualAdvance = coordinator.playNext();
    releaseFirstAttempt({ status: "started", playbackId: 100 });
    await Promise.all([automaticAdvance, manualAdvance]);

    expect(snapshots[snapshots.length - 1]?.currentRowKey).toBe("b");
    expect(attempts).toEqual([1, 2, 2]);
    expect(stalePlaybackIds).toEqual([100]);
  });
});

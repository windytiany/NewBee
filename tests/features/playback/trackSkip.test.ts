import { describe, expect, it } from "bun:test";
import { PlaybackQueueCoordinator } from "@/features/playback/queue/coordinator";
import type { PlaybackDisplayTrack, PlaybackCommandInvoker } from "@/features/playback/types";
import { createTrackSkipState } from "@/features/playback/queue/skip";

function tracks(...ids: number[]): PlaybackDisplayTrack[] {
  return ids.map((trackId, index) => ({
    trackId,
    rowKey: String(index),
    title: String(trackId),
    album: null,
    durationMs: 100,
  }));
}

function harness(initialSkipped: number[] = []) {
  const skipped = new Set(initialSkipped);
  const starts: number[] = [];
  const stops: number[] = [];
  const finishes: number[] = [];
  let playbackId = 0;
  const coordinator = new PlaybackQueueCoordinator(
    async (trackId) => {
      starts.push(trackId);
      return { status: "started", playbackId: ++playbackId };
    },
    () => {},
    {
      random: () => 0.99,
      isTrackSkipped: (trackId) => skipped.has(trackId),
      stopPlayback: async (id) => {
        stops.push(id);
        return true;
      },
      finishPlayback: async (id) => {
        finishes.push(id);
      },
    },
  );
  return {
    coordinator,
    skipped,
    starts,
    stops,
    finishes,
    get playbackId() {
      return playbackId;
    },
  };
}

for (const shuffle of [false, true]) {
  describe(`${shuffle ? "shuffle" : "sequential"} track skip`, () => {
    it("keeps skipped and duplicate tracks in the queue, but never starts them automatically", async () => {
      const h = harness([2, 3]);
      h.coordinator.setShuffleEnabled(shuffle);
      const queue = tracks(1, 2, 2, 3, 4);
      await h.coordinator.replaceAndPlay(queue, "0", false);
      expect(h.coordinator.snapshot.displayedTracks).toEqual(queue);
      expect(h.coordinator.gaplessPlan?.candidates.map((item) => item.trackId)).toEqual([4]);
      await h.coordinator.observePlaybackState(h.playbackId, false, true);
      expect(h.starts).toEqual([1, 4]);
      expect(h.coordinator.snapshot.queuePlaybackError).toBe("");
    });

    it("honors cancellation of skip before selection without rebuilding the queue", async () => {
      const h = harness([2]);
      h.coordinator.setShuffleEnabled(shuffle);
      await h.coordinator.replaceAndPlay(tracks(1, 2, 3), "0", false);
      h.skipped.delete(2);
      h.coordinator.refreshTrackPreferences();
      await h.coordinator.playNext();
      expect(h.starts).toEqual([1, 2]);
    });

    it("lets a double-click play the flagged track without clearing its flag or looping it", async () => {
      const h = harness([2]);
      h.coordinator.setShuffleEnabled(shuffle);
      h.coordinator.setRepeatOneEnabled(true);
      await h.coordinator.replaceAndPlay(tracks(1, 2, 3), "1");
      expect(h.starts).toEqual([2]);
      expect(h.skipped.has(2)).toBe(true);
      await h.coordinator.observePlaybackState(h.playbackId, false, true);
      expect(h.starts).toEqual([2, 3]);
      await h.coordinator.playQueueItem("1");
      expect(h.starts).toEqual([2, 3, 2]);
    });

    it("does not interrupt a flagged current track and finishes when every successor is skipped", async () => {
      const h = harness([2, 3]);
      h.coordinator.setShuffleEnabled(shuffle);
      h.coordinator.setRepeatOneEnabled(true);
      await h.coordinator.replaceAndPlay(tracks(1, 2, 3), "0");
      h.skipped.add(1);
      h.coordinator.refreshTrackPreferences();
      expect(h.stops).toEqual([]);
      expect(h.coordinator.gaplessPlan?.candidates).toEqual([]);
      await h.coordinator.observePlaybackState(h.playbackId, false, true);
      expect(h.finishes).toEqual([1]);
      expect(h.starts).toEqual([1]);
      expect(h.coordinator.snapshot.displayedTracks).toHaveLength(3);
    });

    it("retains an entirely skipped album or playlist without starting anything", async () => {
      const h = harness([1, 2]);
      h.coordinator.setShuffleEnabled(shuffle);
      const queue = tracks(1, 2);
      expect(await h.coordinator.replaceAndPlay(queue, "0", false)).toBe(false);
      expect(h.starts).toEqual([]);
      expect(h.coordinator.snapshot.displayedTracks).toEqual(queue);
      expect(h.coordinator.snapshot.canPlayNext).toBe(false);
    });

    it("skips flagged tracks added as next or at the queue tail", async () => {
      const h = harness([2]);
      h.coordinator.setShuffleEnabled(shuffle);
      await h.coordinator.replaceAndPlay(tracks(1, 3), "0");
      const flagged = { trackId: 2, title: "2", album: null, durationMs: 100 };
      await h.coordinator.addToNext(flagged);
      await h.coordinator.addToQueueEnd(flagged);
      await h.coordinator.playNext();
      expect(h.starts).toEqual([1, 3]);
      expect(h.coordinator.snapshot.displayedTracks).toHaveLength(4);
      expect(h.coordinator.snapshot.canPlayNext).toBe(false);
    });

    it("previous follows live flags in queue order or playback history", async () => {
      const h = harness();
      h.coordinator.setShuffleEnabled(shuffle);
      await h.coordinator.replaceAndPlay(tracks(1, 2, 3), "0");
      await h.coordinator.playNext();
      await h.coordinator.playNext();
      h.skipped.add(2);
      h.coordinator.refreshTrackPreferences();
      await h.coordinator.playPrevious();
      expect(h.starts).toEqual([1, 2, 3, 1]);
      h.skipped.delete(2);
      h.coordinator.refreshTrackPreferences();
      await h.coordinator.playNext();
      expect(h.starts[h.starts.length - 1]).toBe(2);
    });
  });
}

it("stops the old playback when replacing it with an entirely skipped queue", async () => {
  const h = harness([2, 3]);
  await h.coordinator.replaceAndPlay(tracks(1), "0");
  const replacement = tracks(2, 3);
  await h.coordinator.replaceAndPlay(replacement, "0", false);
  expect(h.starts).toEqual([1]);
  expect(h.stops).toEqual([1]);
  expect(h.coordinator.snapshot.displayedTracks).toEqual(replacement);
  expect(h.coordinator.snapshot.currentRowKey).toBeNull();
});

it("rechecks a live flag during an asynchronous automatic start and advances rather than treating it as a failure", async () => {
  const skipped = new Set<number>();
  const starts: number[] = [];
  const coordinator = new PlaybackQueueCoordinator(
    async (trackId, canStart) => {
      if (trackId === 2) skipped.add(2);
      if (!canStart()) return { status: "cancelled" };
      starts.push(trackId);
      return { status: "started", playbackId: trackId };
    },
    () => {},
    { isTrackSkipped: (trackId) => skipped.has(trackId) },
  );
  await coordinator.replaceAndPlay(tracks(1, 2, 3), "0");
  await coordinator.playNext();
  expect(starts).toEqual([1, 3]);
  expect(coordinator.snapshot.queuePlaybackError).toBe("");
});

it("waits for restored preferences before selecting an automatic starting track", async () => {
  const skipped = new Set<number>();
  const starts: number[] = [];
  let loaded!: (ready: boolean) => void;
  const readiness = new Promise<boolean>((resolve) => {
    loaded = resolve;
  });
  const coordinator = new PlaybackQueueCoordinator(
    async (trackId) => {
      starts.push(trackId);
      return { status: "started", playbackId: trackId };
    },
    () => {},
    {
      isTrackSkipped: (trackId) => skipped.has(trackId),
      loadTrackPreferences: () => readiness,
    },
  );
  const starting = coordinator.replaceAndPlay(tracks(1, 2), "0", false);
  await Promise.resolve();
  expect(starts).toEqual([]);
  skipped.add(1);
  loaded(true);
  await starting;
  expect(starts).toEqual([2]);
});

it("does not start playback when persisted preferences could not be loaded", async () => {
  const starts: number[] = [];
  const coordinator = new PlaybackQueueCoordinator(
    async (trackId) => {
      starts.push(trackId);
      return { status: "started", playbackId: trackId };
    },
    () => {},
    { loadTrackPreferences: async () => false },
  );
  expect(await coordinator.replaceAndPlay(tracks(1, 2), "0", false)).toBe(false);
  expect(starts).toEqual([]);
});

it("applies skip to genuinely shuffled candidate order without deleting queue rows", async () => {
  const starts: number[] = [];
  const coordinator = new PlaybackQueueCoordinator(
    async (trackId) => {
      starts.push(trackId);
      return { status: "started", playbackId: trackId };
    },
    () => {},
    { random: () => 0, isTrackSkipped: (trackId) => trackId === 2 },
  );
  coordinator.setShuffleEnabled(true);
  await coordinator.replaceAndPlay(tracks(1, 2, 3, 4), "0");
  await coordinator.playNext();
  await coordinator.playNext();
  expect(starts).toEqual([1, 3, 4]);
  expect(coordinator.snapshot.displayedTracks).toHaveLength(4);
  expect(coordinator.snapshot.canPlayNext).toBe(false);
});

function preferences(initialIds: number[] = []) {
  const persisted = new Set(initialIds);
  let failWrites = false;
  const invoke: PlaybackCommandInvoker = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    if (command === "list_skipped_track_ids") return [...persisted] as T;
    if (command !== "set_tracks_skipped") throw new Error(`Unexpected command: ${command}`);
    if (failWrites) throw new Error("write failed");
    for (const id of args?.trackIds as number[]) {
      if (args?.skipped) persisted.add(id);
      else persisted.delete(id);
    }
    return undefined as T;
  };
  return {
    state: createTrackSkipState(invoke),
    restart: () => createTrackSkipState(invoke),
    fail: () => {
      failWrites = true;
    },
    get persisted() {
      return persisted;
    },
  };
}

it("persists global track preferences and restores them after restart", async () => {
  const h = preferences([2]);
  await h.state.load();
  expect(h.state.isSkipped(2)).toBe(true);
  await h.state.setTracksSkipped([1, 1, 3], true);
  await h.state.setTracksSkipped([2], false);
  const restarted = h.restart();
  await restarted.load();
  expect(restarted.skippedTrackIds.value).toEqual([1, 3]);
  expect(restarted.isSkipped(2)).toBe(false);
});

it("does not publish a preference if its database write fails", async () => {
  const h = preferences([1]);
  await h.state.load();
  h.fail();
  const failure = await h.state.setTracksSkipped([1], false).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toContain("write failed");
  expect(h.state.isSkipped(1)).toBe(true);
  expect(h.state.isPending.value).toBe(false);
});

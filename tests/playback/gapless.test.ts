import { beforeEach, describe, expect, it } from "bun:test";
import { createPlaybackSession } from "@/playback/session";
import type { PlaybackCommandInvoker, PlaybackTransition } from "@/playback/state";
import type { InternalPlaybackStatus } from "@/playback/status";
import type { PlaybackDisplayTrack } from "@/playback/queue/model";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
beforeEach(() => storage.clear());

function tracks(...ids: number[]): PlaybackDisplayTrack[] {
  return ids.map((trackId) => ({
    trackId,
    rowKey: String(trackId),
    title: String(trackId),
    album: null,
    durationMs: 1000,
  }));
}

async function settle() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

function harness(failedTrackIds: number[] = []) {
  let id = 0;
  let current: PlaybackTransition | null = null;
  let prepared: PlaybackTransition | null = null;
  const starts: number[] = [];
  const preparations: { trackId: number | null; revision: number }[] = [];
  const skipped = new Set<number>();
  let status: InternalPlaybackStatus = {
    hasAudio: false,
    isPlaying: false,
    hasEnded: false,
    playbackId: null,
    positionMs: 0,
    durationMs: 0,
  };
  const invokeCommand: PlaybackCommandInvoker = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    if (command === "list_skipped_track_ids") return [...skipped] as T;
    if (command === "set_tracks_skipped") {
      for (const id of args?.trackIds as number[]) {
        if (args?.skipped) skipped.add(id);
        else skipped.delete(id);
      }
      return undefined as T;
    }
    if (command === "playback_status") return { ...status } as T;
    if (command === "play_track") {
      const trackId = args?.trackId as number;
      starts.push(trackId);
      current = {
        trackId,
        playbackId: ++id,
        rowKey: args?.rowKey as string,
        previousPlaybackId: 0,
        title: String(trackId),
        artist: null,
      };
      status = {
        hasAudio: true,
        isPlaying: true,
        hasEnded: false,
        playbackId: id,
        positionMs: 0,
        durationMs: 1000,
      };
      return { ...current } as T;
    }
    if (command === "prepare_next_track") {
      const trackId = args?.trackId as number | null;
      preparations.push({ trackId, revision: args?.revision as number });
      if (current === null || args?.playbackId !== current.playbackId) return false as T;
      prepared = null;
      if (trackId === null) return true as T;
      if (failedTrackIds.includes(trackId)) throw new Error("AUDIO_FILE_NOT_FOUND: missing file");
      prepared = {
        trackId,
        playbackId: ++id,
        rowKey: args?.rowKey as string,
        previousPlaybackId: current.playbackId,
        title: String(trackId),
        artist: null,
      };
      return true as T;
    }
    if (command === "stop_playback") return true as T;
    throw new Error(`Unexpected command: ${command}`);
  };
  const session = createPlaybackSession({ invokeCommand, restoredQueueSnapshot: null });
  return {
    session,
    starts,
    preparations,
    setPositionAtDuration() {
      status.positionMs = status.durationMs;
    },
    crossBoundary(notify = true) {
      if (prepared === null) throw new Error("Next track was not prepared");
      current = prepared;
      prepared = null;
      status = {
        hasAudio: true,
        isPlaying: true,
        hasEnded: false,
        playbackId: current.playbackId,
        positionMs: 10,
        durationMs: 1000,
        nowPlaying: current,
      };
      if (notify) return session.observePlaybackTransition(current);
      return false;
    },
    get prepared() {
      return prepared;
    },
  };
}

describe("gapless queue playback", () => {
  it("prepares each sequential successor and adopts backend transitions without restarting audio", async () => {
    const h = harness();
    await h.session.playTracks(tracks(1, 2, 3), "1");
    await settle();
    expect(h.prepared?.trackId).toBe(2);
    expect(h.session.state.currentRowKey.value).toBe("1");
    expect(h.crossBoundary()).toBe(true);
    await settle();
    expect(h.session.state.currentRowKey.value).toBe("2");
    expect(h.prepared?.trackId).toBe(3);
    expect(h.crossBoundary()).toBe(true);
    await settle();
    expect(h.session.state.currentRowKey.value).toBe("3");
    expect(h.session.state.canPlayNext.value).toBe(false);
    expect(h.starts).toEqual([1]);
    expect(h.preparations.map((item) => item.trackId)).toEqual([2, 3, null]);
    expect(h.session.state.queuePlaybackError.value).toBe("");
  });

  it("recovers a missed transition from backend status without issuing play_track", async () => {
    const h = harness();
    await h.session.playTracks(tracks(1, 2, 3), "1");
    await settle();
    h.crossBoundary(false);
    await h.session.refreshPlaybackStatus();
    await settle();
    expect(h.session.state.currentRowKey.value).toBe("2");
    expect(h.session.state.playbackStatus.value.positionMs).toBe(10);
    expect(h.prepared?.trackId).toBe(3);
    expect(h.starts).toEqual([1]);
  });

  it("keeps the ready successor when only the queue tail changes", async () => {
    const h = harness();
    await h.session.playTracks(tracks(1, 2), "1");
    await settle();
    const readyPlaybackId = h.prepared?.playbackId;
    await h.session.addToQueueEnd(tracks(3)[0]!);
    await settle();
    expect(h.prepared?.playbackId).toBe(readyPlaybackId);
    expect(h.preparations.map((item) => item.trackId)).toEqual([2]);
    expect(h.crossBoundary()).toBe(true);
    await settle();
    expect(h.prepared?.trackId).toBe(3);
  });

  it("replaces a removed upcoming row before the boundary", async () => {
    const h = harness();
    await h.session.playTracks(tracks(1, 2, 3), "1");
    await settle();
    expect(await h.session.removeQueueItems(["2"])).toEqual({ status: "removed" });
    await settle();
    expect(h.prepared?.trackId).toBe(3);
    expect(h.crossBoundary()).toBe(true);
    expect(h.session.state.currentRowKey.value).toBe("3");
    expect(h.starts).toEqual([1]);
    expect(h.preparations[1]!.revision).toBeGreaterThan(h.preparations[0]!.revision);
  });

  it("replaces the prepared successor when inserting play-next", async () => {
    const h = harness();
    await h.session.playTracks(tracks(1, 2), "1");
    await settle();
    const inserted = tracks(3)[0]!;
    await h.session.addToNext(inserted);
    await settle();
    expect(h.prepared?.trackId).toBe(3);
    expect(h.crossBoundary()).toBe(true);
    await settle();
    expect(h.prepared?.trackId).toBe(2);
    expect(h.starts).toEqual([1]);
  });

  it("skips a missing upcoming file during preparation, while keeping current audio running", async () => {
    const h = harness([2]);
    await h.session.playTracks(tracks(1, 2, 3), "1");
    await settle();
    expect(h.prepared?.trackId).toBe(3);
    expect(h.session.state.currentRowKey.value).toBe("1");
    expect(h.session.state.queuePlaybackError.value).toContain("音频文件不存在");
    expect(h.crossBoundary()).toBe(true);
    expect(h.session.state.currentRowKey.value).toBe("3");
    expect(h.starts).toEqual([1]);
  });

  it("prepares repeat-one without adding a manual restart or changing the row", async () => {
    const h = harness();
    await h.session.playTracks(tracks(1, 2), "1");
    await settle();
    h.session.setRepeatOneEnabled(true);
    await settle();
    expect(h.prepared?.trackId).toBe(1);
    expect(h.crossBoundary()).toBe(true);
    await settle();
    expect(h.session.state.currentRowKey.value).toBe("1");
    expect(h.prepared?.trackId).toBe(1);
    expect(h.starts).toEqual([1]);
    h.session.setRepeatOneEnabled(false);
    await settle();
    expect(h.prepared?.trackId).toBe(2);
  });

  for (const shuffle of [false, true]) {
    it(`updates a prepared successor when skip changes in ${shuffle ? "shuffle" : "sequential"} mode`, async () => {
      const h = harness();
      h.session.setShuffleEnabled(shuffle);
      await h.session.playTracks(tracks(1, 2), "1");
      await settle();
      expect(h.prepared?.trackId).toBe(2);
      await h.session.setTracksSkipped([2], true);
      await settle();
      expect(h.prepared).toBeNull();
      expect(h.session.state.skippedTrackIds.value).toEqual([2]);
      expect(h.session.state.displayedTracks.value).toHaveLength(2);
      await h.session.setTracksSkipped([2], false);
      await settle();
      expect(h.prepared?.trackId).toBe(2);
      expect(h.crossBoundary()).toBe(true);
      expect(h.session.state.currentTrack.value?.trackId).toBe(2);
      expect(h.starts).toEqual([1]);
    });
  }

  it("does not restart or repeat a current track when it is marked skipped", async () => {
    const h = harness();
    await h.session.playTracks(tracks(1, 2), "1");
    h.session.setRepeatOneEnabled(true);
    await settle();
    expect(h.prepared?.trackId).toBe(1);
    await h.session.setTracksSkipped([1], true);
    await settle();
    expect(h.session.state.currentTrack.value?.trackId).toBe(1);
    expect(h.prepared?.trackId).toBe(2);
    expect(h.starts).toEqual([1]);
  });

  it("adopts a boundary that already occurred before the track was marked skipped", async () => {
    const h = harness();
    await h.session.playTracks(tracks(1, 2, 3), "1");
    await settle();
    h.crossBoundary(false);
    await h.session.setTracksSkipped([2], true);
    await settle();
    await h.session.refreshPlaybackStatus();
    await settle();
    expect(h.session.state.currentTrack.value?.trackId).toBe(2);
    expect(h.prepared?.trackId).toBe(3);
    expect(h.starts).toEqual([1]);
  });

  it("album playback skips its first flagged track while an explicit track request still plays it", async () => {
    const h = harness();
    await h.session.setTracksSkipped([1], true);
    await h.session.playTracks(tracks(1, 2), "1", false);
    expect(h.starts).toEqual([2]);
    await h.session.playTracks(tracks(1, 2), "1");
    expect(h.starts).toEqual([2, 1]);
    expect(h.session.state.skippedTrackIds.value).toEqual([1]);
  });

  it("does not truncate a track just because the displayed position reaches duration", async () => {
    const h = harness();
    await h.session.playTracks(tracks(1, 2), "1");
    await settle();
    h.setPositionAtDuration();
    await h.session.refreshPlaybackStatus();
    expect(h.session.state.currentRowKey.value).toBe("1");
    expect(h.starts).toEqual([1]);
  });
});

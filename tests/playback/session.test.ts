import { beforeEach, describe, expect, it } from "bun:test";
import { createPlaybackSession, type PlaybackStatus } from "@/playback/session";
import type { PlaybackCommandInvoker } from "@/playback/state";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";

const CURRENT_TRACK_STORAGE_KEY = "newbee.current-track";
const storedValues = new Map<string, string>();
const localStorage = {
  getItem(key: string) {
    return storedValues.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    storedValues.set(key, value);
  },
  removeItem(key: string) {
    storedValues.delete(key);
  },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function asPlaybackInvoker(
  handler: (command: string, args?: Record<string, unknown>) => Promise<unknown> | unknown,
): PlaybackCommandInvoker {
  return async <T>(command: string, args?: Record<string, unknown>) => {
    if (command === "prepare_next_track") return true as T;
    return (await handler(command, args)) as T;
  };
}

function tracks(...entries: [rowKey: string, trackId: number][]): PlaybackDisplayTrack[] {
  return entries.map(([rowKey, trackId]) => ({
    rowKey,
    trackId,
    title: rowKey,
    album: null,
    durationMs: 100,
  }));
}

function noAudioStatus(): PlaybackStatus & { playbackId: number | null } {
  return {
    hasAudio: false,
    isPlaying: false,
    hasEnded: false,
    playbackId: null,
    positionMs: 0,
    durationMs: 0,
  };
}

function playingStatus(
  playbackId: number,
  positionMs = 10,
): PlaybackStatus & { playbackId: number } {
  return {
    hasAudio: true,
    isPlaying: true,
    hasEnded: false,
    playbackId,
    positionMs,
    durationMs: 100,
  };
}

function endedStatus(playbackId: number): PlaybackStatus & { playbackId: number } {
  return {
    hasAudio: true,
    isPlaying: false,
    hasEnded: true,
    playbackId,
    positionMs: 100,
    durationMs: 100,
  };
}

function trackStarted(trackId: number, playbackId: number) {
  return { trackId, title: `Track ${trackId}`, artist: "Artist", playbackId };
}

function resetStorage() {
  storedValues.clear();
}

async function settlePendingCallbacks() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

beforeEach(resetStorage);

describe("playback session", () => {
  for (const shuffleEnabled of [false, true]) {
    it(`rewinds and pauses the final track in ${shuffleEnabled ? "shuffle" : "sequential"} mode while retaining its metadata and queue row`, async () => {
      let activeStatus = playingStatus(1);
      const commands: string[] = [];
      const invokeCommand = asPlaybackInvoker((command, args) => {
        commands.push(command);
        if (command === "playback_status") return { ...activeStatus };
        if (command === "play_track") {
          activeStatus = playingStatus(1);
          return trackStarted(args?.trackId as number, 1);
        }
        if (command === "pause") {
          activeStatus = { ...activeStatus, isPlaying: false };
          return;
        }
        if (command === "seek_to") {
          activeStatus = {
            ...activeStatus,
            positionMs: args?.positionMs as number,
            hasEnded: false,
          };
          return;
        }
        if (command === "resume") {
          activeStatus = { ...activeStatus, isPlaying: true };
          return;
        }
        throw new Error(`Unexpected playback command: ${command}`);
      });
      const session = createPlaybackSession({ invokeCommand, restoredQueueSnapshot: null });
      session.setShuffleEnabled(shuffleEnabled);
      await session.playTracks(tracks(["a", 1], ["b", 2]), "b");
      await settlePendingCallbacks();
      activeStatus = endedStatus(1);
      expect(await session.refreshPlaybackStatus()).toBe(true);
      expect(session.state.currentTrack.value?.trackId).toBe(2);
      expect(session.state.currentRowKey.value).toBe("b");
      expect(session.state.playbackStatus.value).toEqual({
        hasAudio: true,
        isPlaying: false,
        hasEnded: false,
        positionMs: 0,
        durationMs: 100,
      });
      expect(session.state.canPlayNext.value).toBe(false);
      expect(session.state.canPlayPrevious.value).toBe(!shuffleEnabled);
      const commandsAfterEnd = commands.length;
      await session.refreshPlaybackStatus();
      expect(commands.slice(commandsAfterEnd)).toEqual(["playback_status"]);
      expect(await session.togglePlayback(async () => true)).toBe(true);
      expect(session.state.playbackStatus.value.isPlaying).toBe(true);
      expect(commands.filter((command) => command === "play_track")).toHaveLength(1);
      activeStatus = endedStatus(1);
      await session.refreshPlaybackStatus();
      expect(session.state.playbackStatus.value.positionMs).toBe(0);
      expect(commands.filter((command) => command === "pause")).toHaveLength(2);
    });
  }

  it("does not rewind a newer track when the end reset is superseded", async () => {
    const pauseStarted = deferred<void>();
    const releasePause = deferred<void>();
    let activeStatus = playingStatus(1);
    let playbackId = 0;
    const seekPositions: number[] = [];
    const invokeCommand = asPlaybackInvoker((command, args) => {
      if (command === "playback_status") return { ...activeStatus };
      if (command === "play_track") {
        playbackId += 1;
        activeStatus = playingStatus(playbackId);
        return trackStarted(args?.trackId as number, playbackId);
      }
      if (command === "pause") {
        pauseStarted.resolve();
        return releasePause.promise;
      }
      if (command === "seek_to") {
        seekPositions.push(args?.positionMs as number);
        return;
      }
      throw new Error(`Unexpected playback command: ${command}`);
    });
    const session = createPlaybackSession({ invokeCommand, restoredQueueSnapshot: null });
    await session.playTracks(tracks(["a", 1], ["b", 2]), "b");
    await settlePendingCallbacks();
    activeStatus = endedStatus(1);
    const ending = session.refreshPlaybackStatus();
    await pauseStarted.promise;
    const starting = session.playQueueItem("a");
    releasePause.resolve();
    await ending;
    expect(await starting).toBe(true);
    await settlePendingCallbacks();
    expect(seekPositions).toEqual([]);
    expect(session.state.currentTrack.value?.trackId).toBe(1);
    expect(session.state.playbackStatus.value.isPlaying).toBe(true);
    expect(session.state.playbackStatus.value.positionMs).toBe(10);
  });

  it("cleans up A when the later B intent supersedes its pending start", async () => {
    const firstStartStarted = deferred<void>();
    const releaseFirstStart = deferred<ReturnType<typeof trackStarted>>();
    const attemptedTrackIds: number[] = [];
    const stoppedPlaybackIds: number[] = [];
    let activePlaybackId: number | null = null;
    const invokeCommand = asPlaybackInvoker(async (command, args) => {
      if (command === "playback_status") {
        return activePlaybackId === null ? noAudioStatus() : playingStatus(activePlaybackId);
      }
      if (command === "play_track") {
        const trackId = args?.trackId as number;
        attemptedTrackIds.push(trackId);
        if (trackId === 1) {
          activePlaybackId = 101;
          firstStartStarted.resolve();
          return releaseFirstStart.promise;
        }
        activePlaybackId = 202;
        return trackStarted(trackId, 202);
      }
      if (command === "stop_playback") {
        const playbackId = args?.playbackId as number;
        stoppedPlaybackIds.push(playbackId);
        if (activePlaybackId === playbackId) activePlaybackId = null;
        return true;
      }
      throw new Error(`Unexpected playback command: ${command}`);
    });
    const session = createPlaybackSession({ invokeCommand, restoredQueueSnapshot: null });

    const startingA = session.playTracks(tracks(["a", 1], ["b", 2]), "a");
    await firstStartStarted.promise;
    const startingB = session.playTracks(tracks(["b", 2]), "b");
    releaseFirstStart.resolve(trackStarted(1, 101));

    expect(await startingA).toBe(false);
    expect(await startingB).toBe(true);
    expect(attemptedTrackIds).toEqual([1, 2]);
    expect(stoppedPlaybackIds).toEqual([101]);
    expect(session.state.currentTrack.value?.trackId).toBe(2);
    expect(session.state.currentRowKey.value).toBe("b");
  });

  it("discards an older status response after the current playback changes", async () => {
    const firstStatusStarted = deferred<void>();
    const releaseFirstStatus = deferred<
      ReturnType<typeof playingStatus> | ReturnType<typeof endedStatus>
    >();
    const secondStatusStarted = deferred<void>();
    const releaseSecondStatus = deferred<ReturnType<typeof playingStatus>>();
    let statusCalls = 0;
    let activePlaybackId: number | null = null;
    const invokeCommand = asPlaybackInvoker((command, args) => {
      if (command === "playback_status") {
        statusCalls += 1;
        if (statusCalls === 1) {
          firstStatusStarted.resolve();
          return releaseFirstStatus.promise;
        }
        if (statusCalls === 2) {
          secondStatusStarted.resolve();
          return releaseSecondStatus.promise;
        }
        return activePlaybackId === null ? noAudioStatus() : playingStatus(activePlaybackId, 25);
      }
      if (command === "play_track") {
        const trackId = args?.trackId as number;
        activePlaybackId = trackId === 1 ? 11 : 22;
        return trackStarted(trackId, activePlaybackId);
      }
      throw new Error(`Unexpected playback command: ${command}`);
    });
    const session = createPlaybackSession({ invokeCommand, restoredQueueSnapshot: null });

    await session.playTracks(tracks(["a", 1], ["b", 2], ["c", 3]), "a");
    await firstStatusStarted.promise;
    const startingB = session.playQueueItem("b");
    await secondStatusStarted.promise;
    releaseSecondStatus.resolve(playingStatus(11, 99));
    expect(await startingB).toBe(true);
    await settlePendingCallbacks();

    releaseFirstStatus.resolve(endedStatus(11));
    await settlePendingCallbacks();
    expect(session.state.playbackStatus.value.positionMs).toBe(0);
    expect(session.state.currentTrack.value?.trackId).toBe(2);
    expect(session.state.currentRowKey.value).toBe("b");

    expect(await session.refreshPlaybackStatus()).toBe(true);
    expect(session.state.playbackStatus.value.positionMs).toBe(25);
  });

  it("ignores an old end event while pausing and honors the paused state", async () => {
    const pauseStarted = deferred<void>();
    const releasePause = deferred<void>();
    const oldPollStarted = deferred<void>();
    const releaseOldPoll = deferred<ReturnType<typeof endedStatus>>();
    let shouldDeferPoll = false;
    let activeStatus: PlaybackStatus & { playbackId: number } = playingStatus(1);
    const attemptedTrackIds: number[] = [];
    const invokeCommand = asPlaybackInvoker((command, args) => {
      if (command === "playback_status") {
        if (shouldDeferPoll) {
          shouldDeferPoll = false;
          oldPollStarted.resolve();
          return releaseOldPoll.promise;
        }
        return activeStatus;
      }
      if (command === "play_track") {
        const trackId = args?.trackId as number;
        attemptedTrackIds.push(trackId);
        activeStatus = playingStatus(1);
        return trackStarted(trackId, 1);
      }
      if (command === "pause") {
        pauseStarted.resolve();
        return releasePause.promise.then(() => {
          activeStatus = endedStatus(1);
        });
      }
      throw new Error(`Unexpected playback command: ${command}`);
    });
    const session = createPlaybackSession({ invokeCommand, restoredQueueSnapshot: null });
    await session.playTracks(tracks(["a", 1], ["b", 2]), "a");
    await settlePendingCallbacks();

    shouldDeferPoll = true;
    void session.refreshPlaybackStatus();
    await oldPollStarted.promise;
    const toggling = session.togglePlayback(async () => true);
    await pauseStarted.promise;
    releaseOldPoll.resolve(endedStatus(1));
    await settlePendingCallbacks();
    expect(attemptedTrackIds).toEqual([1]);

    releasePause.resolve();
    expect(await toggling).toBe(true);
    await session.refreshPlaybackStatus();

    expect(attemptedTrackIds).toEqual([1]);
    expect(session.state.playbackStatus.value.hasEnded).toBe(true);
  });

  it("ignores an old end event during seeking and advances from the post-seek status", async () => {
    const oldPollStarted = deferred<void>();
    const releaseOldPoll = deferred<ReturnType<typeof endedStatus>>();
    let shouldDeferPoll = false;
    let activePlaybackId = 0;
    let activeStatus: PlaybackStatus & { playbackId: number } = playingStatus(1);
    const attemptedTrackIds: number[] = [];
    const invokeCommand = asPlaybackInvoker((command, args) => {
      if (command === "playback_status") {
        if (shouldDeferPoll) {
          shouldDeferPoll = false;
          oldPollStarted.resolve();
          return releaseOldPoll.promise;
        }
        return activeStatus;
      }
      if (command === "play_track") {
        const trackId = args?.trackId as number;
        activePlaybackId += 1;
        attemptedTrackIds.push(trackId);
        activeStatus = playingStatus(activePlaybackId);
        return trackStarted(trackId, activePlaybackId);
      }
      if (command === "seek_to") {
        activeStatus = endedStatus(activePlaybackId);
        return undefined;
      }
      throw new Error(`Unexpected playback command: ${command}`);
    });
    const session = createPlaybackSession({ invokeCommand, restoredQueueSnapshot: null });
    await session.playTracks(tracks(["a", 1], ["b", 2]), "a");
    await settlePendingCallbacks();

    shouldDeferPoll = true;
    void session.refreshPlaybackStatus();
    await oldPollStarted.promise;
    session.beginSeeking();
    releaseOldPoll.resolve(endedStatus(activePlaybackId));
    await settlePendingCallbacks();
    expect(attemptedTrackIds).toEqual([1]);

    expect(await session.seekTo(100)).toBe(true);
    expect(attemptedTrackIds).toEqual([1, 2]);
    expect(session.state.currentTrack.value?.trackId).toBe(2);
    expect(session.state.currentRowKey.value).toBe("b");
  });

  it("does not autoplay a restored queue and starts from its selected row on first play", async () => {
    storedValues.set(
      CURRENT_TRACK_STORAGE_KEY,
      JSON.stringify({ trackId: 999, title: "Old track", artist: "Old artist" }),
    );
    const restoredTracks = tracks(["before", 11], ["selected", 22], ["after", 33]);
    const attemptedTrackIds: number[] = [];
    let activePlaybackId: number | null = null;
    const invokeCommand = asPlaybackInvoker((command, args) => {
      if (command === "playback_status") {
        return activePlaybackId === null ? noAudioStatus() : playingStatus(activePlaybackId);
      }
      if (command === "play_track") {
        const trackId = args?.trackId as number;
        attemptedTrackIds.push(trackId);
        activePlaybackId = 1;
        return trackStarted(trackId, activePlaybackId);
      }
      throw new Error(`Unexpected playback command: ${command}`);
    });
    const session = createPlaybackSession({
      invokeCommand,
      restoredQueueSnapshot: {
        displayedTracks: restoredTracks,
        currentRowKey: "selected",
        nextRowKeys: [],
        shuffleEnabled: true,
        repeatOneEnabled: true,
      },
    });

    expect(attemptedTrackIds).toEqual([]);
    expect(session.state.currentTrack.value?.trackId).toBe(999);
    expect(session.state.canStartRestoredQueue.value).toBe(true);
    expect(await session.togglePlayback(async () => true)).toBe(true);

    expect(attemptedTrackIds).toEqual([22]);
    expect(session.state.currentTrack.value?.trackId).toBe(22);
    expect(session.state.currentRowKey.value).toBe("selected");
    expect(session.state.shuffleEnabled.value).toBe(true);
    expect(session.state.repeatOneEnabled.value).toBe(true);
  });
});

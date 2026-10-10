import { describe, expect, it } from "bun:test";
import { createPlaybackSession } from "@/features/playback/session";
import type { PlaybackSessionReply, PlaybackSessionSnapshot } from "@/features/playback/session";
import type { PlaybackCommandInvoker } from "@/features/playback/types";
import { playbackFixture, playbackReply, playbackSnapshot } from "../../support/playbackSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const rows = [1, 2].map((trackId) => ({
  trackId,
  rowKey: `row:${trackId}`,
  title: `Track ${trackId}`,
  album: null,
  durationMs: 100,
}));

async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("backend playback session adapter", () => {
  it("loads the restored projection without issuing any playback command or writing localStorage", async () => {
    const fixture = playbackFixture({
      initialSnapshot: playbackSnapshot({
        displayedTracks: rows,
        currentRowKey: "row:2",
        shuffleEnabled: true,
        repeatOneEnabled: true,
      }),
    });
    await fixture.session.ready;
    expect(fixture.calls).toEqual(["snapshot"]);
    expect(fixture.session.state.displayedTracks.value).toEqual(rows);
    expect(fixture.session.state.currentPlaybackId.value).toBeNull();
    expect(fixture.session.state.canStartRestoredQueue.value).toBe(true);
    await fixture.session.togglePlayback();
    expect(fixture.calls).toEqual(["snapshot", "toggle"]);
    expect(fixture.session.state.currentRowKey.value).toBe("row:2");
  });

  it("sends typed queue commands and never computes navigation or preload candidates", async () => {
    const fixture = playbackFixture();
    await fixture.session.ready;
    await fixture.session.playTracks(rows, "row:1", false);
    await fixture.session.playPreviousTrack();
    await fixture.session.playNextTrack();
    await fixture.session.setShuffleEnabled(true);
    await fixture.session.setRepeatOneEnabled(true);
    await fixture.session.addTracksToNext(rows);
    expect(fixture.commands.slice(1)).toEqual([
      { action: "playTracks", tracks: rows, startRowKey: "row:1", allowSkipped: false },
      { action: "previous" },
      { action: "next" },
      { action: "shuffle", enabled: true },
      { action: "repeat", enabled: true },
      { action: "add", tracks: rows.map((track) => ({ ...track, rowKey: "" })), next: true },
    ]);
  });

  it("status polling displays an ended projection without advancing playback", async () => {
    const fixture = playbackFixture();
    await fixture.session.ready;
    await fixture.session.playTracks(rows, "row:1");
    fixture.emit({
      playbackStatus: {
        hasAudio: true,
        isPlaying: false,
        hasEnded: true,
        positionMs: 100,
        durationMs: 100,
      },
    });
    await fixture.session.refreshPlaybackStatus();
    expect(fixture.calls).toEqual(["snapshot", "playTracks", "progress"]);
    expect(fixture.session.state.currentRowKey.value).toBe("row:1");
    expect(fixture.session.state.playbackStatus.value.hasEnded).toBe(true);
  });

  it("backend events update every field and discard late lower-revision command replies", async () => {
    const fixture = playbackFixture();
    await fixture.session.ready;
    const old = deferred<PlaybackSessionReply>();
    fixture.defer(old.promise);
    const command = fixture.session.playTracks(rows, "row:1");
    fixture.emit({
      revision: 10,
      displayedTracks: rows,
      currentRowKey: "row:2",
      currentPlaybackId: 99,
      currentTrack: { trackId: 2, title: "New", artist: null },
      skippedTrackIds: [1],
      canPlayPrevious: true,
    });
    const revision = fixture.snapshot.revision;
    old.resolve(playbackReply(playbackSnapshot({ revision: revision - 1, currentRowKey: "old" })));
    await command;
    expect(fixture.session.state.currentRowKey.value).toBe("row:2");
    expect(fixture.session.state.currentPlaybackId.value).toBe(99);
    expect(fixture.session.state.skippedTrackIds.value).toEqual([1]);
    expect(fixture.session.state.canPlayPrevious.value).toBe(true);
  });

  it("an older status response cannot overwrite a newer subscribed playback instance", async () => {
    const old = deferred<PlaybackSessionReply>();
    let receive: (snapshot: PlaybackSessionSnapshot) => void = () => {};
    const invokeCommand: PlaybackCommandInvoker = async <T>() => (await old.promise) as T;
    const session = createPlaybackSession({
      invokeCommand,
      subscribe: async (listener) => {
        receive = listener;
        return () => {};
      },
    });
    await Promise.resolve();
    receive(
      playbackSnapshot({
        revision: 4,
        currentPlaybackId: 44,
        currentTrack: { trackId: 4, title: "New", artist: null },
      }),
    );
    old.resolve(playbackReply(playbackSnapshot({ revision: 3 })));
    await session.ready;
    expect(session.state.currentPlaybackId.value).toBe(44);
  });

  it("seeking keeps only UI preview state and passes the expected playback instance to backend", async () => {
    const fixture = playbackFixture();
    await fixture.session.ready;
    await fixture.session.playTracks(rows, "row:1");
    fixture.session.beginSeeking();
    expect(fixture.session.state.isSeeking.value).toBe(true);
    expect(await fixture.session.seekTo(75)).toBe(true);
    expect(fixture.commands.slice(-2)).toEqual([
      { action: "beginSeeking" },
      { action: "seek", positionMs: 75, playbackId: 1 },
    ]);
    expect(fixture.session.state.isSeeking.value).toBe(false);
  });

  it("retains sidecar lyrics when editing detaches playback, ignores stale reads, and rereads on real restart", async () => {
    const first = deferred<unknown>();
    const reads: number[] = [];
    const second = { kind: "plain", text: "Second" } as const;
    const fixture = playbackFixture({
      invokeExtra: (name, args) => {
        if (name !== "get_playback_sidecar_lyrics") throw new Error(`Unexpected command ${name}`);
        reads.push(args?.trackId as number);
        return reads.length === 1 ? first.promise : second;
      },
    });
    await fixture.session.ready;
    await fixture.session.playTracks(rows, "row:1");
    await fixture.session.playQueueItem("row:2");
    first.resolve({ kind: "plain", text: "Stale" });
    await settle();
    expect(fixture.session.state.sidecarLyrics.value).toEqual(second);
    await fixture.session.withMetadataEditing([2], async () => {});
    expect(fixture.session.state.sidecarLyrics.value).toEqual(second);
    expect(reads).toEqual([1, 2]);
    await fixture.session.togglePlayback();
    await settle();
    expect(reads).toEqual([1, 2, 2]);
  });

  it("forwards removal outcomes instead of claiming a failed or superseded removal succeeded", async () => {
    const fixture = playbackFixture();
    await fixture.session.ready;
    for (const removal of [
      { status: "stop-unconfirmed" },
      { status: "superseded" },
      { status: "stop-failed", message: "busy" },
    ] as const) {
      fixture.defer(Promise.resolve(playbackReply(fixture.snapshot, { removal })));
      expect(await fixture.session.removeQueueItems(["row:1"])).toEqual(removal);
    }
  });

  it("disposes the subscription and ignores late events and sidecar replies", async () => {
    const late = deferred<unknown>();
    const fixture = playbackFixture({ invokeExtra: () => late.promise });
    await fixture.session.ready;
    await fixture.session.playTracks(rows, "row:1");
    fixture.session.dispose();
    fixture.emit({ currentRowKey: "row:2" });
    late.resolve({ kind: "plain", text: "Late" });
    await settle();
    expect(fixture.session.state.currentRowKey.value).toBe("row:1");
    expect(fixture.session.state.sidecarLyrics.value).toBeNull();
  });

  it("loads skip preferences from authoritative snapshots and only publishes confirmed database writes", async () => {
    let fail = false;
    const fixture = playbackFixture({
      initialSnapshot: playbackSnapshot({ skippedTrackIds: [1] }),
      invokeExtra: () => {
        if (fail) throw new Error("write failed");
      },
    });
    await fixture.session.ready;
    await fixture.session.setTracksSkipped([2, 2], true);
    expect(fixture.session.state.skippedTrackIds.value).toEqual([1, 2]);
    fail = true;
    await expect(fixture.session.setTracksSkipped([1], false)).rejects.toThrow("write failed");
    expect(fixture.session.state.skippedTrackIds.value).toEqual([1, 2]);
    expect(fixture.session.state.isTrackSkipPending.value).toBe(false);
  });
});

it("does not send a late seek after a newer track operation replaces the preview", async () => {
  const fixture = playbackFixture();
  await fixture.session.ready;
  await fixture.session.playTracks(rows, "row:1");
  const begin = deferred<PlaybackSessionReply>();
  fixture.defer(begin.promise);
  const oldSnapshot = fixture.snapshot;
  fixture.session.beginSeeking();
  const seeking = fixture.session.seekTo(99);
  await fixture.session.playQueueItem("row:2");
  begin.resolve(playbackReply(oldSnapshot));
  expect(await seeking).toBe(false);
  expect(fixture.commands.filter((command) => command.action === "seek")).toEqual([]);
  expect(fixture.session.state.currentRowKey.value).toBe("row:2");
});

import { expect, it } from "bun:test";
import { createPlaybackSession } from "@/features/playback/session";
import type { PlaybackMetadataDelta, PlaybackSessionSnapshot } from "@/features/playback/session";
import type { PlaybackCommandInvoker } from "@/features/playback/types";
import type { TrackDetails } from "@/features/tracks/types";
import { playbackReply, playbackSnapshot } from "../../../support/playback/session";

it("metadata IPC projects full track details onto the strict playback contract", async () => {
  const calls: Record<string, unknown>[] = [];
  const invokeCommand: PlaybackCommandInvoker = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    if (command === "playback_session_metadata" && args) {
      calls.push(args);
      return null as T;
    }
    return playbackReply(playbackSnapshot()) as T;
  };
  const session = createPlaybackSession({ invokeCommand, subscribe: async () => () => {} });
  await session.ready;
  const track: TrackDetails = {
    id: 1,
    path: "C:/music/song.mp3",
    title: "Song",
    artist: "Artist",
    album: "Album",
    albumArtist: "Album Artist",
    releaseDate: null,
    discNumber: null,
    trackNumber: null,
    discTotal: null,
    trackTotal: null,
    durationMs: 1000,
    codec: "MP3",
    sampleRateHz: 44100,
    bitrateKbps: 320,
    channels: 2,
  };
  await session.updateTrackMetadata([track]);
  expect(calls).toEqual([
    { tracks: [{ id: 1, title: "Song", artist: "Artist", album: "Album", durationMs: 1000 }] },
  ]);
  session.dispose();
});

function fixture(count = 5000) {
  let snapshot = playbackSnapshot({
    revision: 2,
    displayedTracks: Array.from({ length: count }, (_, index) => ({
      trackId: index + 1,
      rowKey: `row:${index}`,
      title: "Pending",
      album: null,
      durationMs: null,
    })),
    currentTrack: { trackId: 1, title: "Pending", artist: null },
    currentRowKey: "row:0",
    currentPlaybackId: 1,
  });
  let metadata: (delta: PlaybackMetadataDelta) => void = () => {};
  let full: (snapshot: PlaybackSessionSnapshot) => void = () => {};
  const calls: string[] = [];
  let pending: Promise<PlaybackMetadataDelta | null> | null = null;
  let error: Error | null = null;
  let revision = snapshot.revision;
  const invokeCommand: PlaybackCommandInvoker = async <T>(command: string) => {
    calls.push(command);
    if (command === "playback_session_command") return playbackReply(snapshot) as T;
    if (command === "playback_session_progress")
      return {
        revision,
        structuralRevision: snapshot.structuralRevision,
        playbackStatus: { ...snapshot.playbackStatus, playbackId: 1 },
      } as T;
    if (command === "playback_session_metadata") {
      if (error) throw error;
      return (await pending) as T;
    }
    return null as T;
  };
  const session = createPlaybackSession({
    invokeCommand,
    subscribe: async (receive) => {
      full = receive;
      return () => {};
    },
    subscribeMetadata: async (receive) => {
      metadata = receive;
      return () => {};
    },
  });
  return {
    session,
    calls,
    emit: (delta: PlaybackMetadataDelta) => {
      revision = Math.max(revision, delta.revision);
      metadata(delta);
    },
    full: (next: PlaybackSessionSnapshot) => {
      snapshot = next;
      revision = next.revision;
      full(next);
    },
    setReply: (reply: Promise<PlaybackMetadataDelta | null>) => {
      pending = reply;
    },
    fail: () => {
      error = new Error("DB unavailable");
    },
    setProgressRevision: (next: number) => {
      revision = next;
    },
    get snapshot() {
      return snapshot;
    },
  };
}

it("5000 queue metadata deltas stay incremental and progress never reloads a full projection", async () => {
  const probe = fixture();
  await probe.session.ready;
  const rows = probe.session.state.displayedTracks.value;
  let revision = 2;
  for (let offset = 0; offset < rows.length; offset += 16) {
    probe.setProgressRevision(++revision);
    await probe.session.refreshPlaybackStatus();
    probe.emit({
      revision,
      structuralRevision: 2,
      displayedTracks: rows.slice(offset, offset + 16).map((row) => ({
        ...row,
        title: `Confirmed ${row.trackId}`,
        album: "Album",
        durationMs: 1000,
      })),
      currentTrack: { trackId: 1, title: "Confirmed 1", artist: "Artist" },
    });
    expect(probe.session.state.isPlaybackCommandPending.value).toBe(false);
    await probe.session.refreshPlaybackStatus();
  }
  expect(probe.calls.filter((command) => command === "playback_session_command")).toHaveLength(1);
  expect(probe.calls.filter((command) => command === "playback_session_progress")).toHaveLength(
    626,
  );
  expect(probe.session.state.displayedTracks.value).toBe(rows);
  expect(rows.every((row) => row.title === `Confirmed ${row.trackId}`)).toBe(true);
  expect(rows.map((row) => row.rowKey)).toEqual(
    Array.from({ length: 5000 }, (_, index) => `row:${index}`),
  );
  expect(probe.session.state.currentTrack.value).toEqual({
    trackId: 1,
    title: "Confirmed 1",
    artist: "Artist",
  });
  probe.session.dispose();
});

it("late disjoint deltas patch their rows but cannot overwrite newer row/current edits or structural snapshots", async () => {
  const probe = fixture(3);
  await probe.session.ready;
  const rows = probe.snapshot.displayedTracks;
  const delta = (revision: number, index: number, title: string): PlaybackMetadataDelta => ({
    revision,
    structuralRevision: 2,
    displayedTracks: [{ ...rows[index]!, title }],
    currentTrack: { trackId: 1, title, artist: title },
  });
  probe.emit(delta(4, 1, "Newer"));
  probe.emit(delta(3, 0, "Earlier independent row"));
  expect(probe.session.state.displayedTracks.value.map((row) => row.title)).toEqual([
    "Earlier independent row",
    "Newer",
    "Pending",
  ]);
  expect(probe.session.state.currentTrack.value?.title).toBe("Newer");
  probe.emit(delta(5, 1, "Manual edit"));
  probe.emit(delta(4, 1, "Stale"));
  expect(probe.session.state.displayedTracks.value[1]?.title).toBe("Manual edit");
  probe.full(
    playbackSnapshot({
      revision: 6,
      displayedTracks: [{ ...rows[1]!, title: "Structural" }],
      currentTrack: { trackId: 2, title: "Structural", artist: null },
      currentRowKey: "row:1",
      currentPlaybackId: 1,
    }),
  );
  probe.emit(delta(5, 1, "Before structure"));
  expect(probe.session.state.displayedTracks.value.map((row) => row.title)).toEqual(["Structural"]);
  expect(probe.session.state.currentTrack.value?.title).toBe("Structural");
  await probe.session.refreshPlaybackStatus();
  expect(probe.calls.filter((command) => command === "playback_session_command")).toHaveLength(1);
  probe.session.dispose();
});

it("metadata command stays nonpending, returns failures, and rejects a late reply after a structural change", async () => {
  const probe = fixture(1);
  await probe.session.ready;
  let resolve: (delta: PlaybackMetadataDelta) => void = () => {};
  probe.setReply(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const updating = probe.session.updateTrackMetadata([
    { id: 1, title: "Stale", artist: null, album: null, durationMs: null },
  ]);
  expect(probe.session.state.isPlaybackCommandPending.value).toBe(false);
  probe.full(
    playbackSnapshot({
      revision: 8,
      displayedTracks: [{ trackId: 1, rowKey: "new", title: "New", album: null, durationMs: null }],
      playbackError: "Existing error",
    }),
  );
  resolve({
    revision: 3,
    structuralRevision: 2,
    displayedTracks: [{ ...probe.snapshot.displayedTracks[0]!, rowKey: "row:0", title: "Stale" }],
    currentTrack: null,
  });
  await updating;
  expect(probe.session.state.displayedTracks.value[0]?.title).toBe("New");
  probe.fail();
  await expect(
    probe.session.updateTrackMetadata([
      { id: 1, title: "Failed", artist: null, album: null, durationMs: null },
    ]),
  ).rejects.toThrow("DB unavailable");
  expect(probe.session.state.displayedTracks.value[0]?.title).toBe("New");
  expect(probe.session.state.playbackError.value).toBe("Existing error");
  probe.session.dispose();
});

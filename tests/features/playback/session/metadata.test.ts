import { expect, it } from "bun:test";
import { createPlaybackSession } from "@/features/playback/session";
import type { PlaybackMetadataDelta, PlaybackSessionSnapshot } from "@/features/playback/session";
import type { PlaybackCommandInvoker } from "@/features/playback/types";
import { playbackReply, playbackSnapshot } from "../../../support/playback/session";

function fixture(count = 3) {
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

it("queue metadata deltas stay incremental and progress never reloads a full projection", async () => {
  const probe = fixture();
  await probe.session.ready;
  const rows = probe.session.state.displayedTracks.value;
  let revision = 2;
  for (let offset = 0; offset < rows.length; offset += 2) {
    probe.setProgressRevision(++revision);
    await probe.session.refreshPlaybackStatus();
    probe.emit({
      revision,
      structuralRevision: 2,
      displayedTracks: rows.slice(offset, offset + 2).map((row) => ({
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
  expect(probe.calls.filter((command) => command === "playback_session_progress")).toHaveLength(4);
  expect(probe.session.state.displayedTracks.value).toBe(rows);
  expect(rows.every((row) => row.title === `Confirmed ${row.trackId}`)).toBe(true);
  expect(rows.map((row) => row.rowKey)).toEqual(["row:0", "row:1", "row:2"]);
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

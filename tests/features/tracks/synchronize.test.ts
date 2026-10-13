import { afterEach, expect, it } from "bun:test";
import { effectScope, ref } from "vue";
import { createTracksApi } from "@/features/tracks/api";
import type { TracksInvoker } from "@/features/tracks/api";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { createTagSynchronization } from "@/features/metadata/synchronize";
import { createMetadataSave } from "@/features/metadata/save";
import { useTrackDetails } from "@/features/playback/current/useTrackDetails";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import {
  TRACKS_CHANGED_EVENT,
  reportTracksChanged,
  type TracksChange,
} from "@/features/tracks/events";
import type { TrackDetails, TrackRegistrationResult } from "@/features/tracks/types";
import type { TrackMetadataUpdate } from "@/features/playback/types";
import { playbackFixture } from "../../support/playback/session";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function track(): TrackDetails {
  return {
    id: 7,
    path: "C:\\music\\external.flac",
    title: "Original",
    artist: "Artist",
    album: "Album",
    albumArtist: null,
    releaseDate: null,
    discNumber: null,
    trackNumber: null,
    discTotal: null,
    trackTotal: null,
    durationMs: 1000,
    codec: "FLAC",
    sampleRateHz: null,
    bitrateKbps: null,
    channels: null,
  };
}

function events() {
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  const published: string[] = [];
  for (const name of [TRACKS_CHANGED_EVENT, LIBRARY_CHANGED_EVENT]) {
    target.addEventListener(name, () => published.push(name));
  }
  return published;
}

it("registered external edits release the actual ID and refresh every queue reference and current details without a library event", async () => {
  const published = events();
  const { session, commands } = playbackFixture();
  let snapshot = track();
  await session.playTracks(
    [
      {
        trackId: 7,
        rowKey: "first",
        title: snapshot.title,
        album: snapshot.album,
        durationMs: 1000,
      },
      {
        trackId: 7,
        rowKey: "second",
        title: snapshot.title,
        album: snapshot.album,
        durationMs: 1000,
      },
    ],
    "second",
  );
  const invokeCommand: TracksInvoker = async <T>(command: string) => {
    if (command === "get_track") return snapshot as T;
    expect(command).toBe("get_tracks");
    return [snapshot] as T;
  };
  const scope = effectScope();
  const details = scope.run(() => useTrackDetails(ref(7), invokeCommand));
  try {
    await Bun.sleep(0);
    expect(details?.currentTrackDetails.value?.title).toBe("Original");
    const synchronize = createTagSynchronization(session, invokeCommand);
    const save = createMetadataSave({
      editFiles: session.withMetadataEditing,
      synchronize: synchronize.tracks,
    });
    await save.run({
      targets: [{ trackId: 7, path: snapshot.path }],
      writeTrackIds: [7],
      execute: async () => {
        expect(session.state.currentPlaybackId.value).toBeNull();
        snapshot = { ...snapshot, title: "Written" };
        return [
          {
            trackId: 7,
            path: snapshot.path,
            fileWritten: true,
            databaseUpdated: true,
            error: null,
          },
        ];
      },
    });
    await Bun.sleep(0);
    expect(save.state.results[0]?.databaseUpdated).toBe(true);
    expect(published).toEqual([TRACKS_CHANGED_EVENT]);
    expect(session.state.displayedTracks.value.map((entry) => [entry.rowKey, entry.title])).toEqual(
      [
        ["first", "Written"],
        ["second", "Written"],
      ],
    );
    expect(session.state.currentTrack.value?.title).toBe("Written");
    expect(details?.currentTrackDetails.value?.title).toBe("Written");
    expect(commands.find((command) => command.action === "beginEditing")).toEqual({
      action: "beginEditing",
      trackIds: [7],
    });
    expect(session.state.isPlaybackCommandPending.value).toBe(false);
    expect(await session.togglePlayback()).toBe(true);
    expect(session.state.currentRowKey.value).toBe("second");
  } finally {
    scope.stop();
  }
});

it("typed reread preserves per-track results when presentation refresh fails and never invokes the file editor", async () => {
  const published = events();
  const results = [
    { trackId: 7, databaseUpdated: true, error: null },
    { trackId: 8, databaseUpdated: false, error: "unreadable" },
  ];
  const calls: Array<[string, unknown]> = [];
  const invokeCommand: TracksInvoker = async <T>(command: string, args?: unknown) => {
    calls.push([command, args]);
    if (command === "reread_track_tags") return results as T;
    throw new Error("refresh unavailable");
  };
  expect(await createTracksApi(invokeCommand).rereadTags([7, 8])).toEqual(results);
  calls.length = 0;
  const synchronize = createTrackSynchronization(
    {
      updateTrackMetadata: async () => {
        throw new Error("Unexpected partial playback update");
      },
    },
    invokeCommand,
  );
  expect(await synchronize.reread([7, 8])).toEqual({
    results,
    refreshError: "refresh unavailable",
  });
  expect(calls).toEqual([
    ["reread_track_tags", { trackIds: [7, 8] }],
    ["get_tracks", { trackIds: [7] }],
  ]);
  expect(published).toEqual([TRACKS_CHANGED_EVENT]);
});

it("bulk snapshot synchronization uses one typed IPC and one playback update for a thousand IDs", async () => {
  const published = events();
  const snapshots = Array.from({ length: 1000 }, (_, index) => ({ ...track(), id: index + 1 }));
  const calls: Array<[string, unknown]> = [];
  const updates: Array<readonly TrackMetadataUpdate[]> = [];
  const invokeCommand: TracksInvoker = async <T>(command: string, args?: unknown) => {
    calls.push([command, args]);
    return snapshots as T;
  };
  const synchronization = createTrackSynchronization(
    {
      updateTrackMetadata: async (tracks) => {
        updates.push(tracks);
      },
    },
    invokeCommand,
  );
  await synchronization.refresh([...snapshots.map(({ id }) => id), 1]);
  expect(calls).toEqual([["get_tracks", { trackIds: snapshots.map(({ id }) => id) }]]);
  expect(updates).toEqual([snapshots]);
  expect(published).toEqual([TRACKS_CHANGED_EVENT]);
});

it("typed local registration retains per-path failures and exposes placeholders for subsequent consumers", async () => {
  const results: TrackRegistrationResult[] = [
    { status: "registered", track: { ...track(), title: "external" }, needsMetadata: true },
    { status: "failed", path: "missing.flac", error: "not found" },
    { status: "registered", track: { ...track(), id: 8 }, needsMetadata: false },
  ];
  const calls: Array<[string, unknown]> = [];
  const invokeCommand: TracksInvoker = async <T>(command: string, args?: unknown) => {
    calls.push([command, args]);
    return results as T;
  };
  expect(
    await createTracksApi(invokeCommand).registerLocalFiles([
      "external.flac",
      "missing.flac",
      "existing.flac",
    ]),
  ).toEqual(results);
  expect(calls).toEqual([
    ["register_local_tracks", { paths: ["external.flac", "missing.flac", "existing.flac"] }],
  ]);
});

it("confirmed details reach current details once even when playback synchronization rejects, and unrelated IDs do not reread", async () => {
  const published = events();
  const calls: string[] = [];
  const confirmed = { ...track(), title: "Confirmed" };
  const invokeCommand: TracksInvoker = async <T>(command: string) => {
    calls.push(command);
    return (command === "get_track" ? track() : [confirmed]) as T;
  };
  const changes: TracksChange[] = [];
  window.addEventListener(TRACKS_CHANGED_EVENT, (event) =>
    changes.push((event as CustomEvent<TracksChange>).detail),
  );
  const scope = effectScope();
  const details = scope.run(() => useTrackDetails(ref(7), invokeCommand))!;
  try {
    await Bun.sleep(0);
    reportTracksChanged([8], [{ ...confirmed, id: 8 }]);
    expect(calls).toEqual(["get_track"]);
    published.length = 0;
    changes.length = 0;
    const synchronization = createTrackSynchronization(
      {
        updateTrackMetadata: async () => {
          throw new Error("Playback unavailable");
        },
      },
      invokeCommand,
    );
    await expect(synchronization.refresh([7])).rejects.toThrow("Playback unavailable");
    expect(changes).toEqual([{ trackIds: [7], tracks: [confirmed] }]);
    expect(published).toEqual([TRACKS_CHANGED_EVENT]);
    expect(calls).toEqual(["get_track", "get_tracks"]);
    expect(details.currentTrackDetails.value?.title).toBe("Confirmed");
    expect(details.isLoading.value).toBe(false);
  } finally {
    scope.stop();
  }
});

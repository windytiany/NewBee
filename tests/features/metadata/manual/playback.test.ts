import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { playbackFixture } from "../../../support/playback/session";

import type { TrackDetails } from "@/features/tracks/types";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

function fixture(paused = false, canStop = true) {
  const { session, calls } = playbackFixture({ paused, canStop });
  const queue = [1, 2].map((trackId) => ({
    trackId,
    rowKey: `row:${trackId}`,
    title: "Old title",
    album: "Album",
    durationMs: 1000,
  }));
  return { session, calls, queue };
}
function updatedTrack(): TrackDetails {
  return {
    id: 1,
    path: "/music/1.mp3",
    title: "New title",
    artist: "New artist",
    album: "New album",
    albumArtist: "Artist",
    releaseDate: null,
    trackNumber: null,
    discNumber: null,
    trackTotal: null,
    discTotal: null,
    durationMs: 1000,
    codec: null,
    sampleRateHz: null,
    bitrateKbps: null,
    channels: null,
  };
}

describe("metadata playback synchronization", () => {
  for (const paused of [false, true]) {
    it(`releases a ${paused ? "paused" : "playing"} file, keeps the queue and restarts only on user action`, async () => {
      const { session, calls, queue } = fixture(paused);
      await session.playTracks(queue, "row:1");
      const value = await session.withMetadataEditing([1], async () => {
        expect(session.state.isPlaybackCommandPending.value).toBe(true);
        expect(session.state.currentTrack.value?.trackId).toBe(1);
        expect(session.state.currentPlaybackId.value).toBeNull();
        await session.updateTrackMetadata([updatedTrack()]);
        return "saved";
      });
      expect(value).toBe("saved");
      expect(session.state.currentRowKey.value).toBe("row:1");
      expect(session.state.displayedTracks.value.map(({ rowKey }) => rowKey)).toEqual([
        "row:1",
        "row:2",
      ]);
      expect(session.state.displayedTracks.value[0]?.title).toBe("New title");
      expect(session.state.currentTrack.value?.title).toBe("New title");
      expect(session.state.playbackStatus.value.hasAudio).toBe(false);
      expect(calls.filter((command) => command === "playTracks")).toHaveLength(1);
      expect(calls.filter((command) => command === "beginEditing")).toHaveLength(1);
      expect(await session.togglePlayback()).toBe(true);
      expect(calls.filter((command) => ["playTracks", "toggle"].includes(command))).toHaveLength(2);
      expect(session.state.currentRowKey.value).toBe("row:1");
    });
  }

  it("does not stop playback when editing a different track", async () => {
    const { session, calls, queue } = fixture();
    await session.playTracks(queue, "row:1");
    await session.withMetadataEditing([2], async () => {});
    expect(calls.filter((command) => command === "beginEditing")).toHaveLength(1);
    expect(session.state.currentPlaybackId.value).toBe(1);
  });

  it("does not write files unless stopping the target playback is confirmed", async () => {
    const { session, queue } = fixture(false, false);
    await session.playTracks(queue, "row:1");
    let saved = false;
    await expect(
      session.withMetadataEditing([1], async () => {
        saved = true;
      }),
    ).rejects.toThrow("未能确认");
    expect(saved).toBe(false);
    expect(session.state.currentPlaybackId.value).toBe(1);
    expect(session.state.isPlaybackCommandPending.value).toBe(false);
  });

  it("leaves playback stopped and releases the command lock after a save failure", async () => {
    const { session, queue } = fixture();
    await session.playTracks(queue, "row:1");
    await expect(
      session.withMetadataEditing([1], async () => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");
    expect(session.state.currentTrack.value?.trackId).toBe(1);
    expect(session.state.currentPlaybackId.value).toBeNull();
    expect(session.state.isPlaybackCommandPending.value).toBe(false);
  });
});

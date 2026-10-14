import { afterEach, describe, expect, it } from "bun:test";
import { createMetadataApi } from "@/features/metadata/api";
import { createMetadataSave } from "@/features/metadata/save";
import type { MetadataSaveResult } from "@/features/metadata/types";
import type { Channel, InvokeArgs } from "@tauri-apps/api/core";
import { notifications } from "@/shared/notifications/center";
import { playbackFixture } from "../../../support/playback/session";
const path = "C:\\music\\track.wav";
function result(target = 7): MetadataSaveResult {
  return {
    trackId: target,
    path: target === 7 ? path : "C:\\music\\second.wav",
    fileWritten: true,
    databaseUpdated: true,
    error: null,
  };
}
afterEach(() => notifications.clear());
describe("registered metadata save", () => {
  it("loads snapshots and writes manual and release metadata with numeric IDs", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const api = createMetadataApi(async <T>(command: string, args?: InvokeArgs) => {
      if (Array.isArray(args) || args instanceof ArrayBuffer || ArrayBuffer.isView(args))
        throw new Error("Expected object arguments");
      calls.push({ command, args });
      return [] as T;
    });
    const channel = {} as Channel<MetadataSaveResult>;
    await api.editableTracks([7]);
    await api.saveMetadata([7], [{ field: "lyrics", value: "words" }], channel, "keep");
    await api.saveRelease(
      [{ trackId: 7, changes: [{ field: "title", value: "New" }], writeCover: true }],
      { mimeType: "image/png", data: [1, 2] },
      channel,
    );
    expect(calls.map((call) => call.command)).toEqual([
      "get_editable_tracks",
      "save_track_metadata",
      "save_album_tags",
    ]);
    expect(calls[1].args?.request).toEqual({
      trackIds: [7],
      changes: [{ field: "lyrics", value: "words" }],
      lyricsAction: "keep",
      artworkDrafts: [],
    });
    expect(calls[2].args?.patches).toEqual([
      { trackId: 7, changes: [{ field: "title", value: "New" }], writeCover: true },
    ]);
    expect(calls[2].args?.cover).toEqual({ mimeType: "image/png", data: [1, 2] });
  });
  it("holds the shared playback editing lease for exact IDs and retains partial writes after exceptions and refresh failure", async () => {
    const second = "C:\\music\\second.wav";
    const { session, commands } = playbackFixture();
    await session.playTracks(
      [{ trackId: 7, path, rowKey: "file", title: "Song", album: null, durationMs: 1000 }],
      "file",
    );
    const save = createMetadataSave({
      editFiles: session.withMetadataEditing,
      synchronize: async (targets) => {
        expect(targets).toEqual([7]);
        throw new Error("refresh failed");
      },
      notifyResult: true,
    });
    const results = await save.run({
      targets: [
        { trackId: 7, path },
        { trackId: 8, path: second },
      ],
      writeTrackIds: [7, 8],
      execute: async (progress) => {
        expect(session.state.currentPlaybackId.value).toBeNull();
        expect(session.state.isPlaybackCommandPending.value).toBe(true);
        progress(result());
        throw new Error("connection interrupted after first file");
      },
    });
    expect(commands.find((command) => command.action === "beginEditing")).toEqual({
      action: "beginEditing",
      trackIds: [7, 8],
    });
    expect(results[0]).toEqual(result());
    expect(results[1]).toMatchObject({
      trackId: 8,
      fileWritten: false,
      databaseUpdated: false,
    });
    expect(results[1].error).toContain("connection interrupted");
    expect(save.state.results[0].fileWritten).toBe(true);
    expect(save.state.synchronizationError).toContain("refresh failed");
    expect(session.state.isPlaybackCommandPending.value).toBe(false);
    expect(session.state.currentPlaybackId.value).toBeNull();
  });
});

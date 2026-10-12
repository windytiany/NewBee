import { afterEach, describe, expect, it } from "bun:test";
import { createMetadataApi } from "@/features/metadata/api";
import { createMetadataSave } from "@/features/metadata/save";
import type { MetadataSaveResult } from "@/features/metadata/types";
import type { Channel, InvokeArgs } from "@tauri-apps/api/core";
import { notifications } from "@/shared/notifications/center";
import { playbackFixture } from "../../../support/playback/session";
const path = "C:\\music\\track.wav";
function result(target = path): MetadataSaveResult {
  return { trackId: target, path: target, fileWritten: true, databaseUpdated: false, error: null };
}
afterEach(() => notifications.clear());
describe("file metadata save", () => {
  it("routes manual edits and release matching to file writes, never library snapshot writes", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const api = createMetadataApi(async <T>(command: string, args?: InvokeArgs) => {
      if (Array.isArray(args) || args instanceof ArrayBuffer || ArrayBuffer.isView(args))
        throw new Error("Expected object arguments");
      calls.push({ command, args });
      return [] as T;
    });
    const channel = {} as Channel<MetadataSaveResult>;
    await api.editableTracks([path]);
    await api.saveMetadata([path], [{ field: "lyrics", value: "words" }], channel, "keep");
    await api.saveRelease(
      [{ trackId: path, changes: [{ field: "title", value: "New" }], writeCover: true }],
      { mimeType: "image/png", data: [1, 2] },
      channel,
    );
    expect(calls.map((call) => call.command)).toEqual([
      "get_editable_files",
      "save_file_metadata",
      "save_file_metadata",
    ]);
    expect(calls[1].args?.patches).toEqual([
      { path, changes: [{ field: "lyrics", value: "words" }], writeCover: false },
    ]);
    expect(calls[2].args?.patches).toEqual([
      { path, changes: [{ field: "title", value: "New" }], writeCover: true },
    ]);
    expect(calls[2].args?.cover).toEqual({ action: "replace", data: [1, 2] });
  });
  it("holds the shared playback editing lease for exact paths and retains partial writes after exceptions and refresh failure", async () => {
    const second = "C:\\music\\second.wav";
    const { session, commands } = playbackFixture();
    await session.playTracks(
      [{ trackId: null, path, rowKey: "file", title: "Song", album: null, durationMs: 1000 }],
      "file",
    );
    const save = createMetadataSave({
      editFiles: session.withMetadataEditing,
      synchronize: async (targets) => {
        expect(targets).toEqual([path]);
        throw new Error("refresh failed");
      },
      notifyResult: true,
    });
    const results = await save.run({
      targets: [
        { trackId: path, path },
        { trackId: second, path: second },
      ],
      writeTrackIds: [path, second],
      execute: async (progress) => {
        expect(session.state.currentPlaybackId.value).toBeNull();
        expect(session.state.isPlaybackCommandPending.value).toBe(true);
        progress(result());
        throw new Error("connection interrupted after first file");
      },
    });
    expect(commands.find((command) => command.action === "beginEditing")).toEqual({
      action: "beginEditing",
      trackIds: [],
      paths: [path, second],
    });
    expect(results[0]).toEqual(result());
    expect(results[1]).toMatchObject({
      trackId: second,
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

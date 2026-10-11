import { expect, it } from "bun:test";
import { Channel } from "@tauri-apps/api/core";
import { createMetadataApi } from "@/features/metadata/api";
import type { MetadataSaveResult } from "@/features/metadata/types";

it("sends manual metadata and cover actions in the shared save request", async () => {
  const calls: Array<{ command: string; args: unknown }> = [];
  const api = createMetadataApi(async <T>(command: string, args?: unknown) => {
    calls.push({ command, args });
    return [] as T;
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: { transformCallback: () => 1 } },
  });
  try {
    const onProgress = new Channel<MetadataSaveResult>();
    await api.saveMetadata(
      [1],
      [{ field: "label", value: "Label" }],
      onProgress,
      "keep",
      "operation",
      { action: "replace", data: [1, 2] },
    );
    expect(calls[0]).toEqual({
      command: "save_track_metadata",
      args: {
        request: {
          trackIds: [1],
          changes: [{ field: "label", value: "Label" }],
          lyricsAction: "keep",
          cover: { action: "replace", data: [1, 2] },
        },
        onProgress,
        operationId: "operation",
      },
    });
    await api.saveMetadata([1], [], onProgress, "keep", undefined, { action: "delete" });
    expect(calls[1]).toEqual({
      command: "save_track_metadata",
      args: {
        request: { trackIds: [1], changes: [], lyricsAction: "keep", cover: { action: "delete" } },
        onProgress,
      },
    });
    await api.saveMetadata([1], [{ field: "artistSort", value: null }], onProgress, "keep");
    expect(calls[2]).toEqual({
      command: "save_track_metadata",
      args: {
        request: {
          trackIds: [1],
          changes: [{ field: "artistSort", value: null }],
          lyricsAction: "keep",
          cover: null,
        },
        onProgress,
      },
    });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

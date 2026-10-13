import { expect, it } from "bun:test";
import { createArtworkCollectionApi } from "@/features/artwork/collection/api";

it("requests numeric collections and binary originals or WebP sizes", async () => {
  const calls: Array<{ command: string; args: unknown }> = [];
  const original = Uint8Array.from([1, 2, 3]).buffer;
  const api = createArtworkCollectionApi(async <T>(command: string, args?: unknown) => {
    calls.push({ command, args });
    return (command === "get_track_artwork_collections" ? [] : original) as T;
  });
  await api.collections([1, 2]);
  expect(await api.content("content")).toBe(original);
  for (const size of [128, 512, 2048] as const) await api.content("content", size);
  expect(calls).toEqual([
    { command: "get_track_artwork_collections", args: { trackIds: [1, 2] } },
    ...[null, 128, 512, 2048].map((size) => ({
      command: "get_artwork_content",
      args: { contentId: "content", size },
    })),
  ]);
});

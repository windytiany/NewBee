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
  expect(await api.picture(42)).toBe(original);
  for (const size of [128, 512, 2048] as const) await api.picture(42, size);
  expect(calls).toEqual([
    { command: "get_track_artwork_collections", args: { trackIds: [1, 2] } },
    ...[null, 128, 512, 2048].map((size) => ({
      command: "get_artwork_picture",
      args: { artworkId: 42, size },
    })),
  ]);
});

it("reads associated files and requests a non-writing artwork plan with complete drafts", async () => {
  const calls: Array<{ command: string; args: unknown }> = [];
  const api = createArtworkCollectionApi(async <T>(command: string, args?: unknown) => {
    calls.push({ command, args });
    return (
      command === "read_artwork_file"
        ? [1, 2]
        : [{ trackId: 1, fileWriteRequired: false, error: null }]
    ) as T;
  });
  const drafts = [
    {
      trackId: 1,
      pictures: [{ source: "linked" as const, path: "D:/cover.png", pictureType: 3 }],
      displayIndex: 0,
    },
  ];
  expect(await api.readFile("D:/cover.png")).toEqual([1, 2]);
  expect(await api.writePlan(drafts)).toEqual([
    { trackId: 1, fileWriteRequired: false, error: null },
  ]);
  expect(calls).toEqual([
    { command: "read_artwork_file", args: { path: "D:/cover.png" } },
    { command: "get_artwork_write_plan", args: { artworkDrafts: drafts } },
  ]);
});

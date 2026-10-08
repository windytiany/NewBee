import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { MAX_ARTWORK_SIZE } from "@/features/artwork/useArtworkSize";

it("frontend artwork requests share the backend and SQL size limit", () => {
  const rust = readFileSync(new URL("../../src-tauri/src/artwork/mod.rs", import.meta.url), "utf8");
  const limit = rust.match(/const MAX_ARTWORK_SIZE: u32 = (\d+);/);
  expect(limit).not.toBeNull();
  expect(MAX_ARTWORK_SIZE).toBe(4096);
  expect(Number(limit?.[1])).toBe(MAX_ARTWORK_SIZE);
});

import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { ARTWORK_SIZES } from "@/features/artwork/size";

it("frontend and backend accept exactly the same three physical pixel sizes", () => {
  const rust = readFileSync(
    new URL("../../../src-tauri/src/artwork/cache.rs", import.meta.url),
    "utf8",
  );
  const sizes = rust.match(/const SIZES: \[u32; 3\] = \[([\d, ]+)\];/);
  expect(sizes).not.toBeNull();
  expect(sizes?.[1]?.split(",").map(Number)).toEqual([...ARTWORK_SIZES]);
  expect(ARTWORK_SIZES).toEqual([128, 512, 2048]);
});

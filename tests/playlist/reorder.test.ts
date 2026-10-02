import { describe, expect, it } from "bun:test";
import { movePlaylistItemsBefore } from "@/playlist/reorder";

describe("歌单条目重排", () => {
  it("移动单条目到后方", () => {
    expect(movePlaylistItemsBefore([1, 2, 3, 4, 5], [2], 5)).toEqual([1, 3, 4, 2, 5]);
  });

  it("连续多选向前移动并保持选中项顺序", () => {
    expect(movePlaylistItemsBefore([1, 2, 3, 4, 5], [3, 2], 1)).toEqual([2, 3, 1, 4, 5]);
  });

  it("不连续多选向后移动并保持选中项顺序", () => {
    expect(movePlaylistItemsBefore([1, 2, 3, 4, 5, 6], [4, 2], 6)).toEqual([1, 3, 5, 2, 4, 6]);
  });

  it("将单条目向前移动", () => {
    expect(movePlaylistItemsBefore([1, 2, 3, 4, 5], [5], 2)).toEqual([1, 5, 2, 3, 4]);
  });

  it("将多选追加到末尾", () => {
    expect(movePlaylistItemsBefore([1, 2, 3, 4, 5], [2, 4], null)).toEqual([1, 3, 5, 2, 4]);
  });

  it("位置未变化时保持原顺序", () => {
    expect(movePlaylistItemsBefore([1, 2, 3, 4], [2, 3], 4)).toEqual([1, 2, 3, 4]);
  });
});

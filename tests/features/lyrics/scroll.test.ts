import { describe, expect, it } from "bun:test";
import {
  calculateLyricsEdgePadding,
  calculateLyricsScrollTop,
  isLyricsScrollKey,
  isLyricsLineVisible,
} from "@/features/lyrics/scroll";

describe("lyrics scrolling geometry and keys", () => {
  it("将目标行中心对齐到容器中心，并限制在可滚动范围内", () => {
    expect(
      calculateLyricsScrollTop(
        { top: 100, scrollTop: 40, clientHeight: 200, scrollHeight: 800 },
        { top: 230, height: 40 },
      ),
    ).toBe(90);
    expect(
      calculateLyricsScrollTop(
        { top: 100, scrollTop: 400, clientHeight: 200, scrollHeight: 600 },
        { top: 900, height: 40 },
      ),
    ).toBe(400);
    expect(calculateLyricsEdgePadding(200, 40, 60)).toEqual({ top: 80, bottom: 70 });
  });

  it("视口内部分可见的歌词可恢复跟随，仅贴边的歌词不可见", () => {
    const viewport = { top: 100, clientHeight: 200 };
    expect(isLyricsLineVisible(viewport, { top: 80, height: 40 })).toBe(true);
    expect(isLyricsLineVisible(viewport, { top: 280, height: 40 })).toBe(true);
    expect(isLyricsLineVisible(viewport, { top: 60, height: 40 })).toBe(false);
    expect(isLyricsLineVisible(viewport, { top: 300, height: 40 })).toBe(false);
  });

  it("滚动键进入 browsing，但歌词 button 的 Enter/Space 激活不算滚动", () => {
    expect(isLyricsScrollKey("ArrowDown", "ArrowDown", false)).toBe(true);
    expect(isLyricsScrollKey("Enter", "Enter", true)).toBe(false);
    expect(isLyricsScrollKey(" ", "Space", true)).toBe(false);
    expect(isLyricsScrollKey(" ", "Space", false)).toBe(true);
  });
});

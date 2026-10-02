import { describe, expect, it } from "bun:test";
import { createAlbumBackgroundPixels } from "@/artwork/albumBackground";

function artworkPixels(colorAt: (x: number, y: number) => number[]) {
  const pixels = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) pixels.set(colorAt(x, y), (y * 32 + x) * 4);
  }
  return pixels;
}

function channel(pixels: Uint8ClampedArray, x: number, y: number, offset: number) {
  const value = pixels[(y * 32 + x) * 4 + offset];
  if (value === undefined) throw new Error("Missing test pixel");
  return value;
}

describe("专辑封面低频背景", () => {
  it("单色封面生成均匀的深色背景，不污染原始像素", () => {
    const source = artworkPixels(() => [20, 60, 240, 255]);
    const copy = source.slice();
    const { pixels, color } = createAlbumBackgroundPixels(source, 32, 32);
    const first = [...pixels.slice(0, 4)];
    for (let index = 0; index < pixels.length; index += 4) {
      expect([...pixels.slice(index, index + 4)]).toEqual(first);
    }
    expect(channel(pixels, 0, 0, 2)).toBeGreaterThan(channel(pixels, 0, 0, 1));
    expect(color).toBe(`rgb(${first.slice(0, 3).join(", ")})`);
    expect(source).toEqual(copy);
  });

  it("多色封面保留大块色彩分布，并柔化色块交界", () => {
    const source = artworkPixels((x) => (x < 16 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const { pixels } = createAlbumBackgroundPixels(source, 32, 32);
    expect(channel(pixels, 0, 16, 0)).toBeGreaterThan(channel(pixels, 0, 16, 2));
    expect(channel(pixels, 31, 16, 2)).toBeGreaterThan(channel(pixels, 31, 16, 0));
    expect(channel(pixels, 15, 16, 0)).toBeGreaterThan(10);
    expect(channel(pixels, 15, 16, 2)).toBeGreaterThan(10);
    expect(Math.abs(channel(pixels, 15, 16, 0) - channel(pixels, 16, 16, 0))).toBeLessThan(10);
  });

  it("去掉高频棋盘纹理", () => {
    const source = artworkPixels((x, y) => {
      const value = (x + y) % 2 === 0 ? 255 : 0;
      return [value, value, value, 255];
    });
    const { pixels } = createAlbumBackgroundPixels(source, 32, 32);
    expect(Math.abs(channel(pixels, 15, 16, 0) - channel(pixels, 16, 16, 0))).toBeLessThan(2);
  });

  it("高亮封面压暗到次要文字仍可读的范围", () => {
    const { pixels, color } = createAlbumBackgroundPixels(
      artworkPixels(() => [255, 255, 255, 255]),
      32,
      32,
    );
    expect(color).toBe("rgb(102, 102, 102)");
    expect(channel(pixels, 0, 0, 3)).toBe(255);
    const linear = (value: number) => ((value / 255 + 0.055) / 1.055) ** 2.4;
    expect((linear(229) + 0.05) / (linear(102) + 0.05)).toBeGreaterThan(4.5);
  });

  it("透明像素不引入隐藏的亮色", () => {
    const { pixels, color } = createAlbumBackgroundPixels(
      artworkPixels(() => [255, 255, 255, 0]),
      32,
      32,
    );
    expect(color).toBe("rgb(0, 0, 0)");
    expect(channel(pixels, 0, 0, 3)).toBe(255);
  });

  it("拒绝无效像素尺寸", () => {
    expect(() => createAlbumBackgroundPixels(new Uint8ClampedArray(4), 0, 1)).toThrow(RangeError);
    expect(() => createAlbumBackgroundPixels(new Uint8ClampedArray(4), 2, 1)).toThrow(RangeError);
  });
});

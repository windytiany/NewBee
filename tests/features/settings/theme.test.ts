import { afterEach, describe, expect, it } from "bun:test";
import { applyTheme, THEMES } from "@/features/settings/theme";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

describe("application theme", () => {
  it("applies all themes to the root, including dialogs outside the app", () => {
    const dataset: { theme?: string } = {};
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { documentElement: { dataset } },
    });
    for (const option of THEMES) {
      applyTheme(option.value);
      expect(dataset.theme).toBe(option.value);
    }
  });
});

function supportedCodePoints(css: string) {
  const ranges = [...css.matchAll(/unicode-range:\s*([^;]+);/g)].flatMap((match) =>
    match[1]!.split(",").map((range) => {
      const [start, end = start] = range.trim().replace(/^U\+/i, "").split("-");
      return [Number.parseInt(start!, 16), Number.parseInt(end!, 16)] as const;
    }),
  );
  return (character: string) => {
    const codePoint = character.codePointAt(0)!;
    return ranges.some(([start, end]) => start <= codePoint && codePoint <= end);
  };
}

describe("bundled multilingual fonts", () => {
  it("covers Chinese titles, English and Japanese with real variable weights", async () => {
    const sc = await Bun.file(
      new URL("../../../node_modules/@fontsource-variable/noto-sans-sc/index.css", import.meta.url),
    ).text();
    const jp = await Bun.file(
      new URL("../../../node_modules/@fontsource-variable/noto-sans-jp/index.css", import.meta.url),
    ).text();
    const supportsChinese = supportedCodePoints(sc);
    const supportsJapanese = supportedCodePoints(jp);
    for (const character of "地球上最后一个EMO男孩红牌罚下帽子戏法再见米卢盲人摸象游戏结束(outro)") {
      expect(supportsChinese(character)).toBe(true);
    }
    for (const character of "日本語音楽東京こんにちはカタカナEnglish") {
      expect(supportsJapanese(character)).toBe(true);
    }
    expect(sc).toContain("font-weight: 100 900");
    expect(jp).toContain("font-weight: 100 900");
  });
});

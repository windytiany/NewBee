import { afterEach, describe, expect, it } from "bun:test";
import {
  ACCENT_COLORS,
  DEFAULT_ACCENT_COLOR,
  applyAccentColor,
  normalizeAccentColor,
} from "@/features/settings/accent";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

describe("application accent color", () => {
  it("defaults to Spotify green and applies presets and custom colors at the root", () => {
    expect(DEFAULT_ACCENT_COLOR).toBe("#1ed760");
    const styles: Record<string, string> = {};
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: {
          style: {
            setProperty: (key: string, value: string) => {
              styles[key] = value;
            },
          },
        },
      },
    });
    for (const color of [...ACCENT_COLORS.map(({ value }) => value), "#123456", "#ABCDEF"]) {
      applyAccentColor(color);
      expect(styles).toEqual({ "--app-accent": color.toLowerCase() });
    }
  });

  it("normalizes custom colors and rejects unsupported or unsafe CSS values", () => {
    expect(normalizeAccentColor(" #ABCDEF ")).toBe("#abcdef");
    for (const color of [
      "",
      "#abc",
      "#12345678",
      "#gggggg",
      "123456",
      "red",
      "var(--app-base)",
      "#123456; color:red",
    ]) {
      expect(normalizeAccentColor(color)).toBeNull();
      expect(() => applyAccentColor(color)).toThrow("主题色必须是有效的 #RRGGBB 颜色。");
    }
  });

  it("keeps a single fixed dark palette with the default accent", async () => {
    const css = await Bun.file("src/app/styles/themes.css").text();
    expect(css).toContain(`--app-accent: ${DEFAULT_ACCENT_COLOR}`);
    expect(css).toContain("--app-base: #121212");
    expect(css).not.toContain("data-theme");
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

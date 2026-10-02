import { afterEach, describe, expect, it } from "bun:test";
import { evaluateModule, transpileScript } from "../support/moduleLoader";
import { THEMES, type Theme } from "@/settings/theme";

const output = transpileScript(
  await Bun.file(new URL("../../src/settings/theme.ts", import.meta.url)).text(),
);
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

function createTheme(isTauriApp: boolean, invoke: () => Promise<unknown>) {
  const dataset: { theme?: string } = {};
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { dataset } },
  });
  const theme = evaluateModule<{
    applyTheme: (theme: Theme) => void;
    restoreTheme: () => Promise<void>;
  }>(output, { "@tauri-apps/api/core": { invoke, isTauri: () => isTauriApp } });
  return { ...theme, dataset };
}

describe("application theme", () => {
  for (const option of THEMES) {
    it(`restores ${option.value} from desktop settings`, async () => {
      const theme = createTheme(true, async () => ({ theme: option.value }));
      await theme.restoreTheme();
      expect(theme.dataset.theme).toBe(option.value);
    });
  }

  it("applies changes to the root, including dialogs outside the app", () => {
    const theme = createTheme(false, async () => undefined);
    theme.applyTheme("catppuccin");
    expect(theme.dataset.theme).toBe("catppuccin");
    theme.applyTheme("spotify");
    expect(theme.dataset.theme).toBe("spotify");
  });

  it("does not read desktop settings in browser preview", async () => {
    let calls = 0;
    const theme = createTheme(false, async () => calls++);
    await theme.restoreTheme();
    expect(calls).toBe(0);
    expect(theme.dataset.theme).toBeUndefined();
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
      new URL("../../node_modules/@fontsource-variable/noto-sans-sc/index.css", import.meta.url),
    ).text();
    const jp = await Bun.file(
      new URL("../../node_modules/@fontsource-variable/noto-sans-jp/index.css", import.meta.url),
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

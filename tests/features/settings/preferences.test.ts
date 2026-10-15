import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { locale, setLocale } from "@/shared/i18n/locale";
import { evaluateSource, transpileScript } from "../../support/module/loader";
import type { Settings } from "@/features/settings/types";

const output = transpileScript(
  await Bun.file(new URL("../../../src/features/settings/preferences.ts", import.meta.url)).text(),
);
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  setLocale("zh-CN");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

function createPreferences(
  desktop: boolean,
  settings: Pick<Settings, "accentColor" | "reducedMotion" | "locale" | "layoutDensity">,
) {
  const dataset: Record<string, string> = {};
  const styles: Record<string, string> = {};
  let calls = 0;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        dataset,
        style: {
          setProperty: (key: string, value: string) => {
            styles[key] = value;
          },
        },
      },
    },
  });
  const preferences = evaluateSource<typeof import("@/features/settings/preferences")>(output, {
    vue: Vue,
    "@tauri-apps/api/core": {
      isTauri: () => desktop,
      invoke: async (command: string) => {
        expect(command).toBe("get_settings");
        calls++;
        return settings;
      },
    },
  });
  return {
    preferences,
    dataset,
    styles,
    get calls() {
      return calls;
    },
  };
}

describe("application preference restoration", () => {
  for (const reducedMotion of [false, true]) {
    it(`restores accent color and reduced motion ${reducedMotion} from one settings read`, async () => {
      const test = createPreferences(true, {
        locale: "zh-CN",
        accentColor: "#123abc",
        layoutDensity: "compact",
        reducedMotion,
      });
      await test.preferences.restorePreferences();
      expect(test.calls).toBe(1);
      expect(test.dataset).toEqual({
        reducedMotion: String(reducedMotion),
        layoutDensity: "compact",
      });
      expect(test.styles).toEqual({ "--app-accent": "#123abc" });
    });
  }

  for (const savedLocale of ["zh-CN", "en"] as const) {
    it(`restores language ${savedLocale} with appearance from one settings read`, async () => {
      setLocale(savedLocale === "en" ? "zh-CN" : "en");
      const test = createPreferences(true, {
        locale: savedLocale,
        layoutDensity: "regular",
        accentColor: "#123abc",
        reducedMotion: false,
      });
      await test.preferences.restorePreferences();
      expect(locale.value).toBe(savedLocale);
      expect(test.calls).toBe(1);
    });
  }

  it("does not query desktop settings in browser preview", async () => {
    const test = createPreferences(false, {
      locale: "zh-CN",
      accentColor: "#1ed760",
      layoutDensity: "regular",
      reducedMotion: false,
    });
    await test.preferences.restorePreferences();
    expect(test.calls).toBe(0);
    expect(test.dataset).toEqual({});
    expect(test.styles).toEqual({});
  });
});

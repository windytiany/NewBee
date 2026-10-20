import { afterEach, describe, expect, it } from "bun:test";
import { applyAppearance } from "@/features/settings/appearance";
import { locale, setLocale } from "@/shared/i18n/locale";

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  setLocale("zh-CN");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

describe("application appearance", () => {
  it("applies appearance without requiring or changing locale", () => {
    const dataset: Record<string, string> = {};
    const styles: Record<string, string> = {};
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
    setLocale("en");
    applyAppearance({
      themeMode: "light",
      accentColor: "#abcdef",
      reducedMotion: true,
      layoutDensity: "compact",
    });
    expect(locale.value).toBe("en");
    expect(styles).toEqual({ "--app-accent": "#abcdef", "--app-on-accent": "#000000" });
    expect(dataset).toEqual({
      themeMode: "light",
      reducedMotion: "true",
      layoutDensity: "compact",
    });
    applyAppearance({
      themeMode: "dark",
      accentColor: "#abcdef",
      reducedMotion: false,
      layoutDensity: "regular",
    });
    expect(dataset).toEqual({
      themeMode: "dark",
      reducedMotion: "false",
      layoutDensity: "regular",
    });
    applyAppearance({
      themeMode: "system",
      accentColor: "#abcdef",
      reducedMotion: false,
      layoutDensity: "regular",
    });
    expect(dataset.themeMode).toBe("system");
  });
});

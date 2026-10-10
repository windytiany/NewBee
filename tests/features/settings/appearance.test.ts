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
    applyAppearance({ accentColor: "#abcdef", reducedMotion: true });
    expect(locale.value).toBe("en");
    expect(styles).toEqual({ "--app-accent": "#abcdef" });
    expect(dataset).toEqual({ reducedMotion: "true" });
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateSource, transpileScript } from "../../support/moduleLoader";
import type { Settings } from "@/features/settings/types";

const output = transpileScript(
  await Bun.file(new URL("../../../src/features/settings/appearance.ts", import.meta.url)).text(),
);
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

function createAppearance(
  desktop: boolean,
  settings: Pick<Settings, "accentColor" | "reducedMotion">,
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
  const appearance = evaluateSource<typeof import("@/features/settings/appearance")>(output, {
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
    appearance,
    dataset,
    styles,
    get calls() {
      return calls;
    },
  };
}

describe("application appearance restoration", () => {
  for (const reducedMotion of [false, true]) {
    it(`restores accent color and reduced motion ${reducedMotion} from one settings read`, async () => {
      const test = createAppearance(true, { accentColor: "#123abc", reducedMotion });
      await test.appearance.restoreAppearance();
      expect(test.calls).toBe(1);
      expect(test.dataset).toEqual({ reducedMotion: String(reducedMotion) });
      expect(test.styles).toEqual({ "--app-accent": "#123abc" });
    });
  }

  it("does not query desktop settings in browser preview", async () => {
    const test = createAppearance(false, { accentColor: "#1ed760", reducedMotion: false });
    await test.appearance.restoreAppearance();
    expect(test.calls).toBe(0);
    expect(test.dataset).toEqual({});
    expect(test.styles).toEqual({});
  });
});

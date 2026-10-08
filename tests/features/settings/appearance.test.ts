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

function createAppearance(desktop: boolean, settings: Pick<Settings, "theme" | "reducedMotion">) {
  const dataset: Record<string, string> = {};
  let calls = 0;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { dataset } },
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
    get calls() {
      return calls;
    },
  };
}

describe("application appearance restoration", () => {
  for (const reducedMotion of [false, true]) {
    it(`restores theme and reduced motion ${reducedMotion} from one settings read`, async () => {
      const test = createAppearance(true, { theme: "catppuccin", reducedMotion });
      await test.appearance.restoreAppearance();
      expect(test.calls).toBe(1);
      expect(test.dataset).toEqual({ theme: "catppuccin", reducedMotion: String(reducedMotion) });
    });
  }

  it("does not query desktop settings in browser preview", async () => {
    const test = createAppearance(false, { theme: "spotify", reducedMotion: false });
    await test.appearance.restoreAppearance();
    expect(test.calls).toBe(0);
    expect(test.dataset).toEqual({});
  });
});

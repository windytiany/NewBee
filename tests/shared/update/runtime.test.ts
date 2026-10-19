import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateSource, transpileScript } from "../../support/module/loader";

const output = transpileScript(await Bun.file("src/shared/update/runtime.ts").text());
const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "navigator", original);
  else Reflect.deleteProperty(globalThis, "navigator");
});

describe("update runtime", () => {
  it.each([
    [false, "Windows", false],
    [true, "Linux", false],
    [true, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", true],
  ] as const)(
    "gates updates for desktop=%s and user agent=%s",
    async (desktop, userAgent, supported) => {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent } });
      let checks = 0;
      const { getUpdater } = evaluateSource<{
        getUpdater: () => { supported: boolean; check: () => Promise<void> };
      }>(output, {
        vue: Vue,
        "@tauri-apps/api/core": { isTauri: () => desktop },
        "@tauri-apps/plugin-updater": {
          check: async () => {
            checks++;
            return null;
          },
        },
      });
      expect(getUpdater()).toBe(getUpdater());
      expect(getUpdater().supported).toBe(supported);
      await getUpdater().check();
      expect(checks).toBe(supported ? 1 : 0);
    },
  );
});

import { logger as diagnosticLogger } from "@/shared/logging/logger";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as Vue from "vue";
import { loadSourceModules } from "../../../support/module/loader";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { Settings } from "@/features/settings/types";

type BackgroundSettings = Pick<Settings, "albumCoverBackground" | "playingCoverBackground">;
const disabled: BackgroundSettings = { albumCoverBackground: false, playingCoverBackground: false };

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const scopes: Vue.EffectScope[] = [];
const mountCallbacks: Array<() => void> = [];
const listeners = new Set<() => Promise<void>>();
const requests: Array<ReturnType<typeof deferred<BackgroundSettings>>> = [];
let desktop: boolean;
const dependencies: Record<string, unknown> = {
  vue: { ...Vue, onMounted: (callback: () => void) => mountCallbacks.push(callback) },
  "@/features/settings/events": { SETTINGS_CHANGED_EVENT },
  "@tauri-apps/api/core": {
    isTauri: () => desktop,
    invoke(command: string) {
      expect(command).toBe("get_settings");
      const request = deferred<BackgroundSettings>();
      requests.push(request);
      return request.promise;
    },
  },
};
await loadSourceModules(["features/settings/appearance/useCoverBackground.ts"], dependencies);
const { useCoverBackground } = dependencies[
  "@/features/settings/appearance/useCoverBackground"
] as typeof import("@/features/settings/appearance/useCoverBackground");

function mountPreference(setting: keyof BackgroundSettings) {
  const scope = Vue.effectScope();
  scopes.push(scope);
  const enabled = scope.run(() => useCoverBackground(setting));
  if (!enabled) throw new Error("Missing preference");
  for (const callback of mountCallbacks.splice(0)) callback();
  return { enabled, dispose: () => scope.stop() };
}

function requestAt(index: number) {
  const request = requests[index];
  if (!request) throw new Error("Missing settings request");
  return request;
}

async function settle() {
  await Promise.resolve();
  await Vue.nextTick();
}

beforeEach(() => {
  desktop = true;
  requests.length = 0;
  listeners.clear();
  mountCallbacks.length = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener(event: string, callback: () => Promise<void>) {
        expect(event).toBe(SETTINGS_CHANGED_EVENT);
        listeners.add(callback);
      },
      removeEventListener(event: string, callback: () => Promise<void>) {
        expect(event).toBe(SETTINGS_CHANGED_EVENT);
        listeners.delete(callback);
      },
    },
  });
});

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

for (const setting of ["albumCoverBackground", "playingCoverBackground"] as const) {
  describe(`${setting} 设置`, () => {
    it("默认关闭，挂载后恢复已保存的设置，保存事件即时刷新", async () => {
      const { enabled } = mountPreference(setting);
      expect(enabled.value).toBe(false);
      expect(listeners.size).toBe(1);
      requestAt(0).resolve({ ...disabled, [setting]: true });
      await settle();
      expect(enabled.value).toBe(true);
      for (const listener of listeners) void listener();
      requestAt(1).resolve(disabled);
      await settle();
      expect(enabled.value).toBe(false);
    });

    it("后发请求优先，不让旧设置覆盖新设置", async () => {
      const { enabled } = mountPreference(setting);
      for (const listener of listeners) void listener();
      requestAt(1).resolve({ ...disabled, [setting]: true });
      await settle();
      requestAt(0).resolve(disabled);
      await settle();
      expect(enabled.value).toBe(true);
    });

    it("卸载后移除监听，未完成请求不再更新状态", async () => {
      const { enabled, dispose } = mountPreference(setting);
      dispose();
      expect(listeners.size).toBe(0);
      requestAt(0).resolve({ ...disabled, [setting]: true });
      await settle();
      expect(enabled.value).toBe(false);
    });

    it("读取失败使用关闭状态，并保留错误上下文", async () => {
      const logger = spyOn(diagnosticLogger, "warn").mockImplementation(() => {});
      try {
        const { enabled } = mountPreference(setting);
        const failure = new Error("Settings unavailable");
        requestAt(0).reject(failure);
        await settle();
        expect(enabled.value).toBe(false);
        expect(logger).toHaveBeenCalledWith(
          "features/settings/appearance/useCoverBackground",
          `Could not restore the ${setting} setting.`,
          failure,
        );
      } finally {
        logger.mockRestore();
      }
    });

    it("浏览器预览不请求桌面设置或监听事件", () => {
      desktop = false;
      const { enabled } = mountPreference(setting);
      expect(enabled.value).toBe(false);
      expect(requests).toEqual([]);
      expect(listeners.size).toBe(0);
    });
  });
}

for (const albumEnabled of [false, true]) {
  for (const playingEnabled of [false, true]) {
    it(`专辑背景 ${albumEnabled} 与播放页背景 ${playingEnabled} 独立恢复和刷新`, async () => {
      const album = mountPreference("albumCoverBackground");
      const playing = mountPreference("playingCoverBackground");
      const saved = {
        albumCoverBackground: albumEnabled,
        playingCoverBackground: playingEnabled,
      };
      requestAt(0).resolve(saved);
      requestAt(1).resolve(saved);
      await settle();
      expect(album.enabled.value).toBe(albumEnabled);
      expect(playing.enabled.value).toBe(playingEnabled);
      for (const listener of listeners) void listener();
      const changed = { ...saved, playingCoverBackground: !playingEnabled };
      requestAt(2).resolve(changed);
      requestAt(3).resolve(changed);
      await settle();
      expect(album.enabled.value).toBe(albumEnabled);
      expect(playing.enabled.value).toBe(!playingEnabled);
    });
  }
}

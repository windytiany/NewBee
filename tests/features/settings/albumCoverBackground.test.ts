import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as Vue from "vue";
import { loadSourceModules } from "../../support/moduleLoader";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";

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
const requests: Array<ReturnType<typeof deferred<{ albumCoverBackground: boolean }>>> = [];
let desktop: boolean;
const dependencies: Record<string, unknown> = {
  vue: { ...Vue, onMounted: (callback: () => void) => mountCallbacks.push(callback) },
  "@/features/settings/events": { SETTINGS_CHANGED_EVENT },
  "@tauri-apps/api/core": {
    isTauri: () => desktop,
    invoke(command: string) {
      expect(command).toBe("get_settings");
      const request = deferred<{ albumCoverBackground: boolean }>();
      requests.push(request);
      return request.promise;
    },
  },
};
await loadSourceModules(["features/settings/composables/useAlbumBackground.ts"], dependencies);
const { useAlbumBackground } = dependencies[
  "@/features/settings/composables/useAlbumBackground"
] as typeof import("@/features/settings/composables/useAlbumBackground");

function mountPreference() {
  const scope = Vue.effectScope();
  scopes.push(scope);
  const enabled = scope.run(() => useAlbumBackground());
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

describe("专辑封面背景设置", () => {
  it("默认关闭，挂载后恢复已保存的设置，保存事件即时刷新", async () => {
    const { enabled } = mountPreference();
    expect(enabled.value).toBe(false);
    expect(listeners.size).toBe(1);
    requestAt(0).resolve({ albumCoverBackground: true });
    await settle();
    expect(enabled.value).toBe(true);
    for (const listener of listeners) void listener();
    requestAt(1).resolve({ albumCoverBackground: false });
    await settle();
    expect(enabled.value).toBe(false);
  });

  it("后发请求优先，不让旧设置覆盖新设置", async () => {
    const { enabled } = mountPreference();
    for (const listener of listeners) void listener();
    requestAt(1).resolve({ albumCoverBackground: true });
    await settle();
    requestAt(0).resolve({ albumCoverBackground: false });
    await settle();
    expect(enabled.value).toBe(true);
  });

  it("卸载后移除监听，未完成请求不再更新状态", async () => {
    const { enabled, dispose } = mountPreference();
    dispose();
    expect(listeners.size).toBe(0);
    requestAt(0).resolve({ albumCoverBackground: true });
    await settle();
    expect(enabled.value).toBe(false);
  });

  it("读取失败使用关闭状态，并保留错误上下文", async () => {
    const logger = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { enabled } = mountPreference();
      const failure = new Error("Settings unavailable");
      requestAt(0).reject(failure);
      await settle();
      expect(enabled.value).toBe(false);
      expect(logger).toHaveBeenCalledWith(
        "Could not restore the album cover background setting.",
        failure,
      );
    } finally {
      logger.mockRestore();
    }
  });

  it("浏览器预览不请求桌面设置或监听事件", () => {
    desktop = false;
    const { enabled } = mountPreference();
    expect(enabled.value).toBe(false);
    expect(requests).toEqual([]);
    expect(listeners.size).toBe(0);
  });
});

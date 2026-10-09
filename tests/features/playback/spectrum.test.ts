import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, loadSourceModules, evaluateSource } from "../../support/moduleLoader";

import { createHostNode, createHostRenderer } from "../../support/hostRenderer";
import type { NotificationInput } from "@/shared/notifications/center";

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const requests: Array<{ playbackId: number; response: ReturnType<typeof deferred<unknown>> }> = [];
const timers = new Map<number, () => void>();
const listeners = new Set<() => void>();
const mountCallbacks: Array<() => void> = [];
const scopes: Vue.EffectScope[] = [];
const apps: Array<{ unmount: () => void }> = [];
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let nextTimer = 0;
let desktop = true;
const feedback: NotificationInput[] = [];
const warnings: unknown[][] = [];
const testDocument = {
  hidden: false,
  addEventListener(event: string, listener: () => void) {
    expect(event).toBe("visibilitychange");
    listeners.add(listener);
  },
  removeEventListener(event: string, listener: () => void) {
    expect(event).toBe("visibilitychange");
    listeners.delete(listener);
  },
};
const dependencies: Record<string, unknown> = {
  "@/shared/notifications/center": { notify: (input: NotificationInput) => feedback.push(input) },
  "@/shared/logging/logger": { logger: { warn: (...args: unknown[]) => warnings.push(args) } },
  vue: { ...Vue, onMounted: (callback: () => void) => mountCallbacks.push(callback) },
  "@tauri-apps/api/core": {
    isTauri: () => desktop,
    invoke(command: string, args: { playbackId: number }) {
      expect(command).toBe("playback_spectrum");
      const response = deferred<unknown>();
      requests.push({ playbackId: args.playbackId, response });
      return response.promise;
    },
  },
};
await loadSourceModules(["features/playback/composables/useSpectrum.ts"], dependencies);
const { usePlaybackSpectrum } = dependencies[
  "@/features/playback/composables/useSpectrum"
] as typeof import("@/features/playback/composables/useSpectrum");

function mountSpectrum(playing = true) {
  const playbackId = Vue.ref<number | null>(1);
  const active = Vue.ref(playing);
  const scope = Vue.effectScope();
  scopes.push(scope);
  const spectrum = scope.run(() => usePlaybackSpectrum(playbackId, active));
  if (!spectrum) throw new Error("Missing spectrum");
  for (const callback of mountCallbacks.splice(0)) callback();
  return { ...spectrum, playbackId, active, dispose: () => scope.stop() };
}

function requestAt(index: number) {
  const request = requests[index];
  if (!request) throw new Error("Missing spectrum request");
  return request;
}

function advancePoll() {
  const entry = timers.entries().next().value;
  if (!entry) throw new Error("Missing poll timer");
  const [id, callback] = entry;
  timers.delete(id);
  callback();
}

async function settle() {
  await Promise.resolve();
  await Vue.nextTick();
}

function setHidden(hidden: boolean) {
  testDocument.hidden = hidden;
  for (const listener of listeners) listener();
}

beforeEach(() => {
  requests.length = 0;
  feedback.length = 0;
  warnings.length = 0;
  timers.clear();
  listeners.clear();
  mountCallbacks.length = 0;
  testDocument.hidden = false;
  nextTimer = 0;
  desktop = true;
  for (const [key, value] of Object.entries({
    document: testDocument,
    setTimeout: (callback: () => void, interval: number) => {
      expect(interval).toBe(50);
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
  })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const scope of scopes.splice(0)) scope.stop();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalGlobals.clear();
});

describe("实时音频频谱轮询", () => {
  it("只在播放时读取实际播放实例的频谱，钳制幅度并平滑下降", async () => {
    const spectrum = mountSpectrum(false);
    expect(requests).toHaveLength(0);
    spectrum.active.value = true;
    expect(requestAt(0).playbackId).toBe(1);
    requestAt(0).response.resolve([-1, 2, 0.5, 0, 0, 0, 0, 0]);
    await settle();
    expect(spectrum.bands.value).toEqual([0, 1, 0.5, 0, 0, 0, 0, 0]);
    advancePoll();
    requestAt(1).response.resolve(Array(8).fill(0));
    await settle();
    expect(spectrum.bands.value[1]).toBeCloseTo(0.88);
    expect(spectrum.bands.value[2]).toBeCloseTo(0.38);
    spectrum.active.value = false;
    expect(spectrum.bands.value).toEqual(Array(8).fill(0));
    expect(timers.size).toBe(0);
  });

  it("切歌不重叠请求，旧实例的响应不能覆盖新频谱", async () => {
    const spectrum = mountSpectrum();
    spectrum.playbackId.value = 2;
    expect(requests).toHaveLength(1);
    advancePoll();
    expect(requests).toHaveLength(1);
    requestAt(0).response.resolve(Array(8).fill(1));
    await settle();
    expect(spectrum.bands.value).toEqual(Array(8).fill(0));
    advancePoll();
    expect(requestAt(1).playbackId).toBe(2);
    requestAt(1).response.resolve(Array(8).fill(0.4));
    await settle();
    expect(spectrum.bands.value).toEqual(Array(8).fill(0.4));
  });

  it("暂停或停止时清空柱条，忽略尚未返回的响应", async () => {
    const spectrum = mountSpectrum();
    spectrum.active.value = false;
    requestAt(0).response.resolve(Array(8).fill(1));
    await settle();
    expect(spectrum.bands.value).toEqual(Array(8).fill(0));
    expect(timers.size).toBe(0);
    spectrum.active.value = true;
    requestAt(1).response.resolve(Array(8).fill(0.8));
    await settle();
    spectrum.playbackId.value = null;
    expect(spectrum.bands.value).toEqual(Array(8).fill(0));
    expect(timers.size).toBe(0);
  });

  it("隐藏窗口时停止轮询，恢复可见后重新读取", async () => {
    testDocument.hidden = true;
    const spectrum = mountSpectrum();
    expect(requests).toHaveLength(0);
    setHidden(false);
    expect(requests).toHaveLength(1);
    requestAt(0).response.resolve(Array(8).fill(0.5));
    await settle();
    setHidden(true);
    expect(timers.size).toBe(0);
    expect(spectrum.bands.value).toEqual(Array(8).fill(0));
    setHidden(false);
    expect(requests).toHaveLength(2);
  });

  it("错误时清空显示、保留错误上下文，后续成功能恢复", async () => {
    const spectrum = mountSpectrum();
    requestAt(0).response.reject(new Error("IPC unavailable"));
    await settle();
    expect(spectrum.error.value).toContain("IPC unavailable");
    expect(spectrum.bands.value).toEqual(Array(8).fill(0));
    expect(feedback).toEqual([
      { type: "warning", message: "实时频谱不可用，请查看日志", key: "playback-spectrum" },
    ]);
    expect(warnings).toHaveLength(1);
    advancePoll();
    requestAt(1).response.reject(new Error("still unavailable"));
    await settle();
    expect(feedback).toHaveLength(1);
    advancePoll();
    requestAt(2).response.resolve(Array(8).fill(0.3));
    await settle();
    expect(spectrum.error.value).toBe("");
    expect(spectrum.bands.value).toEqual(Array(8).fill(0.3));
  });

  for (const invalid of [null, [1, 2], Array(8).fill(NaN), Array(8).fill("0.5")]) {
    it(`拒绝无效的频谱响应 ${JSON.stringify(invalid)}`, async () => {
      const spectrum = mountSpectrum();
      requestAt(0).response.resolve(invalid);
      await settle();
      expect(spectrum.bands.value).toEqual(Array(8).fill(0));
      expect(spectrum.error.value).toContain("无效的频谱数据");
    });
  }

  it("卸载移除监听和定时器，不处理迟到响应", async () => {
    const spectrum = mountSpectrum();
    spectrum.dispose();
    expect(listeners.size).toBe(0);
    requestAt(0).response.resolve(Array(8).fill(1));
    await settle();
    expect(timers.size).toBe(0);
    expect(spectrum.bands.value).toEqual(Array(8).fill(0));
  });

  it("浏览器预览不请求桌面音频数据", () => {
    desktop = false;
    const spectrum = mountSpectrum();
    expect(requests).toHaveLength(0);
    expect(timers.size).toBe(0);
    expect(spectrum.bands.value).toEqual(Array(8).fill(0));
  });
});

const viewBands = Vue.shallowRef([0, 0.5, 1, 0.1, 0.2, 0.3, 0.4, 0.6]);
const viewError = Vue.ref("");
const PlaybackSpectrum = evaluateSource<{ default: Vue.Component }>(
  compileSfc(
    await Bun.file(
      new URL(
        "../../../src/features/playback/components/controls/PlaybackSpectrum.vue",
        import.meta.url,
      ),
    ).text(),
    "src/features/playback/components/controls/PlaybackSpectrum.vue",
  ),
  {
    vue: Vue,
    "@/features/playback/composables/useSpectrum": {
      usePlaybackSpectrum: () => ({ bands: viewBands, error: viewError }),
    },
  },
).default;

describe("播放条分段频谱", () => {
  it("显示八根小柱条，使用数据高度并尊重减少动态效果偏好", async () => {
    viewBands.value = [0, 0.5, 1, 0.1, 0.2, 0.3, 0.4, 0.6];
    viewError.value = "";
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp(PlaybackSpectrum, {
      playbackId: 1,
      active: true,
    });
    apps.push(app);
    app.mount(root);
    const view = root.children[0];
    if (!view) throw new Error("Missing spectrum view");
    expect(view.props.role).toBe("img");
    expect(view.props["aria-label"]).toBe("实时音频频谱");
    const columns = view.children.filter((node) => node.type === "span");
    expect(columns).toHaveLength(8);
    expect(columns[0]?.children[0]?.props.style).toEqual({ height: "0px" });
    expect(columns[1]?.children[0]?.props.style).toEqual({ height: "15px" });
    expect(columns[2]?.children[0]?.props.style).toEqual({ height: "27px" });
    expect(
      columns.every((node) => String(node.props.class).includes("repeating-linear-gradient")),
    ).toBe(true);
    expect(
      columns.every((node) =>
        String(node.children[0]?.props.class).includes("motion-reduce:transition-none"),
      ),
    ).toBe(true);
    viewError.value = "实时频谱不可用：IPC unavailable";
    await Vue.nextTick();
    expect(view.props.title).toBe("实时音频频谱 · 40 Hz–16 kHz");
  });

  it("空闲时保留完整的低亮度分段底纹，播放和暂停只改变真实频谱层", async () => {
    viewBands.value = Array(8).fill(0);
    viewError.value = "";
    const playback = Vue.reactive<{ playbackId: number | null; active: boolean }>({
      playbackId: null,
      active: false,
    });
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp({
      setup: () => () => Vue.h(PlaybackSpectrum, playback),
    });
    apps.push(app);
    app.mount(root);
    const view = root.children[0];
    if (!view) throw new Error("Missing spectrum view");
    const columns = view.children.filter((node) => node.type === "span");
    expect(columns).toHaveLength(8);
    for (const column of columns) {
      expect(column.props.class).toContain("h-full");
      expect(column.props.class).toContain("text-app-muted/30");
      expect(column.props.class).toContain("repeating-linear-gradient");
      expect(column.children[0]?.props.style).toEqual({ height: "0px" });
    }

    playback.playbackId = 1;
    playback.active = true;
    viewBands.value = Array(8).fill(0.5);
    await Vue.nextTick();
    for (const column of columns) {
      expect(column.children[0]?.props.style).toEqual({ height: "15px" });
    }

    playback.active = false;
    viewBands.value = Array(8).fill(0);
    await Vue.nextTick();
    for (const column of columns) {
      expect(column.children[0]?.props.style).toEqual({ height: "0px" });
    }
    expect(view.children.filter((node) => node.type === "span")).toEqual(columns);
  });
});

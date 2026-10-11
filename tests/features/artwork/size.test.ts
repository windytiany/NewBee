import { expect, it } from "bun:test";
import * as Vue from "vue";
import { selectArtworkSize } from "@/features/artwork/size";
import { loadSourceModules } from "../../support/module/loader";

it("chooses the smallest covering tier and never emits arbitrary dimensions", () => {
  for (const [pixels, expected] of [
    [1, 128],
    [128, 128],
    [128.1, 512],
    [512, 512],
    [512.1, 2048],
    [2048, 2048],
    [6000, 2048],
    [0, 0],
    [-1, 0],
    [NaN, 0],
    [Infinity, 0],
  ] as const) {
    expect(selectArtworkSize(pixels)).toBe(expected);
  }
  expect(selectArtworkSize(null)).toBeNull();
});

it("封面布局和 DPI 变化选择固定档位，隐藏时暂停，卸载释放观察器", async () => {
  const keys = ["ResizeObserver", "devicePixelRatio", "matchMedia"] as const;
  const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  let resize: (
    entries: Array<{ contentRect: { width: number; height: number } }>,
  ) => void = () => {};
  let resolutionChanged: () => void = () => {};
  let disconnected = false;
  let resolutionDisconnected = false;
  class Observer {
    constructor(callback: typeof resize) {
      resize = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  }
  const scope = Vue.effectScope();
  try {
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: Observer });
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2 });
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: () => ({
        addEventListener(_event: string, callback: () => void) {
          resolutionChanged = callback;
          resolutionDisconnected = false;
        },
        removeEventListener() {
          resolutionDisconnected = true;
        },
      }),
    });
    const dependencies: Record<string, unknown> = { vue: Vue };
    await loadSourceModules(["features/artwork/useArtworkSize.ts"], dependencies);
    const { useArtworkSize } = dependencies[
      "@/features/artwork/useArtworkSize"
    ] as typeof import("@/features/artwork/useArtworkSize");
    const element = Vue.shallowRef<HTMLElement | null>(null);
    const size = scope.run(() => useArtworkSize(element));
    expect(size?.value).toBe(0);
    element.value = {} as HTMLElement;
    await Vue.nextTick();
    resize([{ contentRect: { width: 64, height: 64 } }]);
    expect(size?.value).toBe(128);
    resize([{ contentRect: { width: 64.25, height: 64.25 } }]);
    expect(size?.value).toBe(512);
    resize([{ contentRect: { width: 256, height: 256 } }]);
    expect(size?.value).toBe(512);
    resize([{ contentRect: { width: 256.5, height: 256.5 } }]);
    expect(size?.value).toBe(2048);
    resize([{ contentRect: { width: 3000, height: 3000 } }]);
    expect(size?.value).toBe(2048);
    resize([{ contentRect: { width: 50, height: 60 } }]);
    expect(size?.value).toBe(128);
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 3 });
    resolutionChanged();
    expect(size?.value).toBe(512);
    const previousResize = resize;
    element.value = {} as HTMLElement;
    await Vue.nextTick();
    expect(size?.value).toBe(0);
    previousResize([{ contentRect: { width: 10, height: 10 } }]);
    expect(size?.value).toBe(0);
    resize([{ contentRect: { width: 100, height: 100 } }]);
    expect(size?.value).toBe(512);
    resize([{ contentRect: { width: 0, height: 0 } }]);
    expect(size?.value).toBe(0);
    scope.stop();
    expect(disconnected).toBe(true);
    expect(resolutionDisconnected).toBe(true);
  } finally {
    scope.stop();
    keys.forEach((key, index) => {
      const descriptor = originals[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

import { expect, it } from "bun:test";
import * as Vue from "vue";
import { loadSourceModules } from "../../support/moduleLoader";

it("封面布局确定后按设备像素请求尺寸，隐藏时暂停，卸载释放观察器", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const pixelRatio = Object.getOwnPropertyDescriptor(globalThis, "devicePixelRatio");
  let resize: (
    entries: Array<{ contentRect: { width: number; height: number } }>,
  ) => void = () => {};
  let disconnected = false;
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
    const dependencies: Record<string, unknown> = { vue: Vue };
    await loadSourceModules(["features/artwork/useArtworkSize.ts"], dependencies);
    const { useArtworkSize } = dependencies[
      "@/features/artwork/useArtworkSize"
    ] as typeof import("@/features/artwork/useArtworkSize");
    const element = Vue.shallowRef<HTMLElement | null>(null);
    const size = scope.run(() => useArtworkSize(element));
    expect(size?.value).toBe(0);
    // Only observe the element; do not request an arbitrary size before layout.
    element.value = {} as HTMLElement;
    await Vue.nextTick();
    resize([{ contentRect: { width: 128.25, height: 128.25 } }]);
    expect(size?.value).toBe(320);
    resize([{ contentRect: { width: 300, height: 300 } }]);
    expect(size?.value).toBe(640);
    resize([{ contentRect: { width: 300.5, height: 300.5 } }]);
    expect(size?.value).toBe(640);
    resize([{ contentRect: { width: 320.5, height: 320.5 } }]);
    expect(size?.value).toBe(704);
    resize([{ contentRect: { width: 3000, height: 3000 } }]);
    expect(size?.value).toBe(4096);
    const previousResize = resize;
    element.value = {} as HTMLElement;
    await Vue.nextTick();
    expect(size?.value).toBe(4096);
    previousResize([{ contentRect: { width: 10, height: 10 } }]);
    expect(size?.value).toBe(4096);
    resize([{ contentRect: { width: 0, height: 0 } }]);
    expect(size?.value).toBe(0);
    scope.stop();
    expect(disconnected).toBe(true);
  } finally {
    scope.stop();
    for (const [key, descriptor] of [
      ["ResizeObserver", original],
      ["devicePixelRatio", pixelRatio],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

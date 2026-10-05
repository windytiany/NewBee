import { afterEach, describe, expect, it } from "bun:test";
import { ref } from "vue";
import { evaluateSource, transpileScript } from "../../support/moduleLoader";

const output = transpileScript(
  await Bun.file(new URL("../../../src/app/shell/useWindow.ts", import.meta.url)).text(),
);
const originalElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
afterEach(() => {
  if (originalElement) Object.defineProperty(globalThis, "Element", originalElement);
  else Reflect.deleteProperty(globalThis, "Element");
});

function fixture(desktop = true) {
  const calls: string[] = [];
  let maximized = false;
  let mounted!: () => Promise<void>;
  let unmounted!: () => void;
  let resized!: () => void;
  const { useWindow } = evaluateSource<typeof import("@/app/shell/useWindow")>(output, {
    vue: {
      ref,
      onMounted: (callback: typeof mounted) => {
        mounted = callback;
      },
      onUnmounted: (callback: typeof unmounted) => {
        unmounted = callback;
      },
    },
    "@tauri-apps/api/core": { isTauri: () => desktop },
    "@tauri-apps/api/window": {
      getCurrentWindow: () => {
        calls.push("get-window");
        return {
          isMaximized: async () => maximized,
          toggleMaximize: async () => {
            calls.push("maximize");
            maximized = !maximized;
          },
          minimize: async () => {
            calls.push("minimize");
          },
          close: async () => {
            calls.push("close");
          },
          startDragging: async () => {
            calls.push("drag");
          },
          onResized: async (callback: typeof resized) => {
            resized = callback;
            return () => {
              calls.push("unlisten");
            };
          },
        };
      },
    },
  });
  const window = useWindow();
  return {
    window,
    calls,
    mount: () => mounted(),
    unmount: () => unmounted(),
    resize: () => resized(),
    setMaximized: (value: boolean) => {
      maximized = value;
    },
  };
}

describe("desktop window controls", () => {
  it("synchronizes maximize state and releases the resize listener when unmounted", async () => {
    const harness = fixture();
    await harness.mount();
    expect(harness.window.isMaximized.value).toBe(false);
    await harness.window.toggleMaximizeWindow();
    expect(harness.window.isMaximized.value).toBe(true);
    harness.setMaximized(false);
    harness.resize();
    await Promise.resolve();
    expect(harness.window.isMaximized.value).toBe(false);
    await harness.window.minimizeWindow();
    await harness.window.closeWindow();
    harness.unmount();
    expect(harness.calls).toEqual(["get-window", "maximize", "minimize", "close", "unlisten"]);
  });

  it("drags the title bar but never buttons or page navigation", () => {
    class Element {
      constructor(private interactive: boolean) {}
      closest() {
        return this.interactive ? this : null;
      }
    }
    Object.defineProperty(globalThis, "Element", { configurable: true, value: Element });
    const harness = fixture();
    for (const interactive of [true, false]) {
      harness.window.startDragging({ target: new Element(interactive) } as unknown as MouseEvent);
    }
    expect(harness.calls).toEqual(["get-window", "drag"]);
  });

  it("does not access desktop APIs in the browser preview", async () => {
    const harness = fixture(false);
    await harness.mount();
    await harness.window.minimizeWindow();
    await harness.window.toggleMaximizeWindow();
    await harness.window.closeWindow();
    harness.unmount();
    expect(harness.window.isTauriApp).toBe(false);
    expect(harness.calls).toEqual([]);
  });
});

// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, describe, expect, it } from "bun:test";
import { createRenderer, h, ref } from "vue";
import type { Ref } from "vue";
import { calculateAlbumTrackColumns, useAlbumTrackColumns } from "@/library/useAlbumTrackColumns";

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
const mountedApps: Array<{ unmount: () => void }> = [];

function replaceGlobal(name: string, value: unknown) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originalGlobals.clear();
});

describe("专辑曲目列数", () => {
  it("短标题使用双列，包含列间距及行号、时长等固定空间", () => {
    expect(calculateAlbumTrackColumns(800, [300, 384, 280], 32)).toBe(2);
    expect(calculateAlbumTrackColumns(800, [300, 385, 280], 32)).toBe(1);
  });

  it("任意一首过长都会使整个列表改为单列，单列放不下也不再拆列", () => {
    expect(calculateAlbumTrackColumns(800, [300, 600, 280], 32)).toBe(1);
    expect(calculateAlbumTrackColumns(800, [300, 1000, 280], 32)).toBe(1);
  });

  it("根据容器而非窗口宽度重新判断，单曲保持单列", () => {
    expect(calculateAlbumTrackColumns(500, [300, 280], 32)).toBe(1);
    expect(calculateAlbumTrackColumns(1000, [300, 280], 32)).toBe(2);
    expect(calculateAlbumTrackColumns(1000, [300], 32)).toBe(1);
    expect(calculateAlbumTrackColumns(0, [300, 280], 32)).toBe(1);
  });

  it("测量完整曲名及艺术家，缩窄时降列，扩大时恢复双列，卸载时清理", () => {
    let nextHandle = 0;
    const scheduled = new Map<number, FrameRequestCallback>();
    let resize: ResizeObserverCallback | null = null;
    let disconnected = false;
    replaceGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const handle = ++nextHandle;
      scheduled.set(handle, callback);
      return handle;
    });
    replaceGlobal("cancelAnimationFrame", (handle: number) => scheduled.delete(handle));
    replaceGlobal("getComputedStyle", () => ({ columnGap: "32px" }));
    replaceGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {
          disconnected = true;
        }
      },
    );

    let columns!: Ref<1 | 2>;
    let contentWidth = 240;
    const list = {
      clientWidth: 800,
      querySelectorAll: () =>
        [0, 1].map(() => {
          const rowWidth = columns.value === 2 ? (list.clientWidth - 32) / 2 : list.clientWidth;
          return {
            getBoundingClientRect: () => ({ width: rowWidth }),
            querySelector: (selector: string) => ({
              getBoundingClientRect: () => ({
                width: selector === "[data-album-track-label]" ? rowWidth - 100 : contentWidth,
              }),
            }),
          };
        }),
    };
    const renderer = createRenderer<object, object>({
      patchProp() {},
      insert() {},
      remove() {},
      createElement: () => ({}),
      createText: () => ({}),
      createComment: () => ({}),
      setText() {},
      setElementText() {},
      parentNode: () => null,
      nextSibling: () => null,
    });
    const app = renderer.createApp({
      setup() {
        columns = useAlbumTrackColumns(ref(list as unknown as HTMLOListElement));
        return () => h("ol");
      },
    });
    app.mount({});
    mountedApps.push(app);
    function flush() {
      const callbacks = [...scheduled.values()];
      scheduled.clear();
      for (const callback of callbacks) callback(0);
    }
    function notifyResize() {
      resize?.([], {} as ResizeObserver);
    }
    function resizeList() {
      notifyResize();
      flush();
    }

    flush();
    expect(columns.value).toBe(2);
    list.clientWidth = 600;
    resizeList();
    expect(columns.value).toBe(1);
    list.clientWidth = 800;
    resizeList();
    expect(columns.value).toBe(2);
    contentWidth = 500;
    resizeList();
    expect(columns.value).toBe(1);
    contentWidth = 1000;
    resizeList();
    expect(columns.value).toBe(1);
    notifyResize();
    app.unmount();
    mountedApps.splice(mountedApps.indexOf(app), 1);
    expect(disconnected).toBe(true);
    expect(scheduled.size).toBe(0);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { evaluateSource, transpileScript } from "../../support/moduleLoader";

class ScrollElement extends EventTarget {
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight = 500;
  scrollWidth = 100;
  clientHeight = 100;
  clientWidth = 100;
}
type Binding = { value: string; oldValue?: string };
const source = await Bun.file(
  new URL("../../../src/shared/interaction/persistentScroll.ts", import.meta.url),
).text();
const { vPersistentScroll: scroll } = evaluateSource<{
  vPersistentScroll: {
    mounted: (element: ScrollElement, binding: Binding) => void;
    beforeUpdate: (element: ScrollElement, binding: Binding) => void;
    updated: (element: ScrollElement, binding: Binding) => void;
    beforeUnmount: (element: ScrollElement) => void;
  };
}>(transpileScript(source), {});
const properties = ["localStorage", "ResizeObserver", "MutationObserver"] as const;
const original = properties.map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
afterEach(() => {
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function storage(positions: object = {}) {
  const values = new Map([["newbee.scroll-positions", JSON.stringify(positions)]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  for (const key of ["ResizeObserver", "MutationObserver"])
    Object.defineProperty(globalThis, key, { configurable: true, value: undefined });
  return () =>
    JSON.parse(values.get("newbee.scroll-positions")!) as Record<
      string,
      { top: number; left: number }
    >;
}

describe("persistent scroll positions", () => {
  it("waits for visible content without overwriting the restored position", () => {
    const saved = storage({ list: { top: 80, left: 0 } });
    const element = new ScrollElement();
    element.scrollHeight = 0;
    scroll.mounted(element, { value: "list" });
    element.dispatchEvent(new Event("scroll"));
    expect(saved().list?.top).toBe(80);
    element.scrollHeight = 500;
    scroll.updated(element, { value: "list" });
    expect(element.scrollTop).toBe(80);
    scroll.beforeUnmount(element);
  });

  it("lets manual interaction override a pending restore", () => {
    const saved = storage({ list: { top: 80, left: 0 } });
    const element = new ScrollElement();
    element.scrollHeight = 100;
    scroll.mounted(element, { value: "list" });
    element.dispatchEvent(new Event("wheel"));
    element.scrollTop = 20;
    element.dispatchEvent(new Event("scroll"));
    element.scrollHeight = 500;
    scroll.updated(element, { value: "list" });
    expect(element.scrollTop).toBe(20);
    expect(saved().list?.top).toBe(20);
    scroll.beforeUnmount(element);
  });

  it("keeps scope positions separate and removes listeners on unmount", () => {
    const saved = storage({ first: { top: 80, left: 0 }, second: { top: 30, left: 0 } });
    const element = new ScrollElement();
    scroll.mounted(element, { value: "first" });
    scroll.beforeUpdate(element, { value: "second", oldValue: "first" });
    scroll.updated(element, { value: "second", oldValue: "first" });
    expect(element.scrollTop).toBe(30);
    element.scrollTop = 40;
    element.dispatchEvent(new Event("scroll"));
    expect(saved().first?.top).toBe(80);
    expect(saved().second?.top).toBe(40);
    scroll.beforeUnmount(element);
    element.scrollTop = 120;
    element.dispatchEvent(new Event("scroll"));
    expect(saved().second?.top).toBe(40);
  });

  it("ignores invalid positions and unavailable storage without breaking rendering", () => {
    storage({ invalid: { top: -1, left: "bad" } });
    const element = new ScrollElement();
    scroll.mounted(element, { value: "invalid" });
    expect(element.scrollTop).toBe(0);
    scroll.beforeUnmount(element);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("unavailable");
      },
    });
    expect(() => scroll.mounted(element, { value: "other" })).not.toThrow();
    element.dispatchEvent(new Event("scroll"));
    expect(() => scroll.beforeUnmount(element)).not.toThrow();
  });
});

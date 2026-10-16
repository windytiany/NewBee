import { afterEach, expect, it, mock } from "bun:test";
import * as Vue from "vue";
import type { useWidth } from "@/features/library/statistics/useWidth";
import { evaluateSource, transpileScript } from "../../../support/module/loader";
import { createHostNode, createHostRenderer } from "../../../support/host/renderer";

const storageKey = "newbee.library.statistics.width";
const source = transpileScript(
  await Bun.file("src/features/library/statistics/useWidth.ts").text(),
);
const originals = new Map(
  ["localStorage", "ResizeObserver"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

async function harness(stored: string | null = null) {
  const values = new Map<string, string>(stored === null ? [] : [[storageKey, stored]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  const density = Vue.ref("regular");
  const observers: Array<{ measure: () => void; disconnect: ReturnType<typeof mock> }> = [];
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      disconnect = mock(() => {});
      constructor(measure: () => void) {
        observers.push({ measure, disconnect: this.disconnect });
      }
      observe() {}
    },
  });
  const warnings: unknown[][] = [];
  const { useWidth: createWidth } = evaluateSource<{ useWidth: typeof useWidth }>(source, {
    vue: Vue,
    "@/features/settings/layout": { layoutDensity: density },
    "@/shared/logging/logger": { logger: { warn: (...args: unknown[]) => warnings.push(args) } },
  });
  async function mount(containerWidth = 1000) {
    const container = { clientWidth: containerWidth };
    const pane = { parentElement: container } as unknown as HTMLElement;
    const element = Vue.shallowRef<HTMLElement | null>(null);
    let state!: ReturnType<typeof useWidth>;
    const app = createHostRenderer(createHostNode).createApp({
      setup() {
        state = createWidth(element);
        return () => null;
      },
    });
    app.mount(createHostNode("root"));
    apps.push(app);
    element.value = pane;
    await Vue.nextTick();
    return { state, container, element, app, observer: observers[observers.length - 1]! };
  }
  return { mount, values, density, warnings };
}

it("clamps resizing between one album column and half the browser width", async () => {
  const h = await harness();
  const { state } = await h.mount();
  expect(state.width.value).toBe(240);
  expect(state.minWidth.value).toBe(200);
  expect(state.maxWidth.value).toBe(500);
  state.resize(10);
  expect(state.width.value).toBe(200);
  state.resize(900);
  expect(state.width.value).toBe(500);
  h.density.value = "compact";
  expect(state.minWidth.value).toBe(156);
  state.resize(10);
  expect(state.width.value).toBe(156);
  state.resize(Number.NaN);
  expect(state.width.value).toBe(156);
});

it("restores the preference on remount and never overwrites it when the browser shrinks", async () => {
  const h = await harness();
  const first = await h.mount();
  first.state.resize(380);
  expect(h.values.get(storageKey)).toBe("380");
  first.container.clientWidth = 500;
  first.observer.measure();
  expect(first.state.width.value).toBe(250);
  expect(h.values.get(storageKey)).toBe("380");
  first.container.clientWidth = 1000;
  first.observer.measure();
  expect(first.state.width.value).toBe(380);
  const second = await h.mount();
  expect(second.state.width.value).toBe(380);
  second.element.value = null;
  await Vue.nextTick();
  expect(second.observer.disconnect).toHaveBeenCalledTimes(1);
  first.app.unmount();
  apps.splice(apps.indexOf(first.app), 1);
  expect(first.observer.disconnect).toHaveBeenCalledTimes(1);
});

it("keeps the half-width limit in narrow layouts and ignores hidden measurements", async () => {
  const h = await harness("380");
  const pane = await h.mount(300);
  expect(pane.state.minWidth.value).toBe(150);
  expect(pane.state.maxWidth.value).toBe(150);
  expect(pane.state.width.value).toBe(150);
  pane.container.clientWidth = 0;
  pane.observer.measure();
  expect(pane.state.width.value).toBe(150);
  expect(h.values.get(storageKey)).toBe("380");
});

it("falls back safely for corrupt preferences and tolerates storage failures", async () => {
  for (const stored of ["bad json", "null", '"300"', "-1", "1e999"]) {
    const h = await harness(stored);
    const { state } = await h.mount();
    expect(state.width.value).toBe(240);
    expect(h.warnings).toHaveLength(1);
  }
  const h = await harness();
  const { state } = await h.mount();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      setItem: () => {
        throw new Error("Storage unavailable");
      },
    },
  });
  state.resize(300);
  expect(state.width.value).toBe(300);
  expect(h.warnings).toHaveLength(1);
});

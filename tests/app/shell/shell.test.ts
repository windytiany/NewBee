import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, transpileScript, evaluateSource } from "../../support/module/loader";

import { createHostNode, createHostRenderer, findNode } from "../../support/host/renderer";
import type { HostNode } from "../../support/host/renderer";

const storageKey = "newbee.sidebar-layout";
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
const apps: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const [key, descriptor] of [
    ["localStorage", originalStorage],
    ["ResizeObserver", originalObserver],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

it("restores resized panes after a restart without overwriting preferences on smaller measurements", async () => {
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  const observers: Array<
    (entries: Array<{ contentRect: { width: number; height: number } }>) => void
  > = [];
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(callback: (typeof observers)[number]) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  });
  const stateSource = await Bun.file("src/app/shell/usePaneSizes.ts").text();
  const layoutSource = await Bun.file("src/app/shell/AppShell.vue").text();
  const slotStub = Vue.defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        Vue.h("div", slots.default?.()),
  });
  const emptyStub = Vue.defineComponent({ render: () => Vue.h("div") });
  const resizeStub = Vue.defineComponent({
    props: ["label", "value"],
    emits: ["resize"],
    setup:
      (props, { emit }) =>
      () =>
        Vue.h("div", {
          label: props.label,
          value: props.value,
          onResize: (value: number) => emit("resize", value),
        }),
  });
  function mountLayout() {
    const state = evaluateSource(transpileScript(stateSource), { vue: Vue });
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(layoutSource, "src/app/shell/AppShell.vue"),
      {
        vue: Vue,
        "@/app/shell/usePaneSizes": state,
        "@/shared/interaction/resize/ResizeHandle.vue": resizeStub,
        "@/shared/layout/SidePane.vue": slotStub,
        "@/features/playback/current/TrackInfoPanel.vue": emptyStub,
        "@/features/playback/queue/QueueList.vue": emptyStub,
        "@/features/playback/session": {
          usePlaybackSession: () => ({
            state: { displayedTracks: Vue.ref([]), activeQueueRowKey: Vue.ref(null) },
            playQueueItem: () => {},
            removeQueueItems: () => {},
          }),
        },
      },
    ).default;
    const renderer = createHostRenderer<HostNode>((type, text) => ({
      ...createHostNode(type, text),
      style: {},
    }));
    const root: HostNode = createHostNode("root");
    const app = renderer.createApp(component);
    app.mount(root);
    apps.push(app);
    return root;
  }
  const root = mountLayout();
  observers[0]!([{ contentRect: { width: 1400, height: 800 } }]);
  observers[1]!([{ contentRect: { width: 300, height: 800 } }]);
  await Vue.nextTick();
  const layout = findNode(root, (node) =>
    Boolean(
      node.props.style &&
      typeof node.props.style === "object" &&
      "--three-column-layout-columns" in node.props.style,
    ),
  );
  const columns = (layout?.props.style as Record<string, unknown>)["--three-column-layout-columns"];
  expect(columns).toMatch(
    /^minmax\(208px, [\d.]+px\) 0px minmax\(280px, 1fr\) 0px minmax\(240px, [\d.]+px\)$/,
  );
  for (const label of ["调整左侧栏宽度", "调整右侧栏宽度"]) {
    const handle = findNode(root, (node) => node.props.label === label);
    expect(handle?.props.class).toContain("-translate-x-1/2");
    expect(handle?.props.class).toContain("z-20");
  }
  for (const [label, value] of [
    ["调整左侧栏宽度", 300],
    ["调整右侧栏宽度", 320],
    ["调整右侧上下区域高度", 450],
  ] as const) {
    const handle = findNode(root, (node) => node.props.label === label)!;
    (handle.props.onResize as (value: number) => void)(value);
  }
  await Vue.nextTick();
  const preference = stored.get(storageKey);
  expect(JSON.parse(preference!)).toEqual({
    leftPaneWidth: 300,
    rightPaneWidth: 320,
    rightTopHeight: 450,
  });
  apps.pop()!.unmount();

  const restartedRoot = mountLayout();
  observers[2]!([{ contentRect: { width: 800, height: 500 } }]);
  observers[3]!([{ contentRect: { width: 240, height: 500 } }]);
  await Vue.nextTick();
  expect(stored.get(storageKey)).toBe(preference);
  observers[2]!([{ contentRect: { width: 1400, height: 800 } }]);
  observers[3]!([{ contentRect: { width: 320, height: 800 } }]);
  await Vue.nextTick();
  expect(
    findNode(restartedRoot, (node) => node.props.label === "调整右侧上下区域高度")?.props.value,
  ).toBe(450);
  expect(
    findNode(restartedRoot, (node) => node.props.label === "调整右侧栏宽度")?.props.value,
  ).toBe(320);
});

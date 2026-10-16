import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import type { HostNode } from "../../../support/host/renderer";
import type { TrackPlayStatistics } from "@/features/library/statistics/useStatistics";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";

const output = compileSfc(
  await Bun.file(
    new URL("../../../../src/features/library/statistics/LibraryStatistics.vue", import.meta.url),
  ).text(),
  "LibraryStatistics.vue",
);
const apps: Array<{ unmount: () => void }> = [];
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
class HandleElement {
  setPointerCapture() {}
}
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  setLocale("zh-CN");
  for (const [key, descriptor] of [
    ["localStorage", originalStorage],
    ["HTMLElement", originalHTMLElement],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function mount() {
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: HandleElement });
  const tracks = Vue.ref<TrackPlayStatistics[]>([]);
  const visible = Vue.ref(true);
  const isLoading = Vue.ref(false);
  const loadFailed = Vue.ref(false);
  const component = evaluateSource<{ default: Vue.Component }>(output, {
    vue: Vue,
    "@/features/library/statistics/useStatistics": {
      useStatistics: () => ({ tracks, visible, isLoading, loadFailed }),
    },
  }).default;
  const root = createHostNode("root");
  const renderer = createHostRenderer<HostNode>((type, text) =>
    Object.assign(createHostNode(type, text), { parentElement: { clientWidth: 1000 } }),
  );
  const app = renderer.createApp({ setup: () => () => Vue.h(component, { albums: [] }) });
  app.mount(root);
  apps.push(app);
  return { root, tracks, visible, isLoading, loadFailed, stored };
}
it("renders statistics without track actions and hides the pane and resize handle together", async () => {
  const h = mount();
  expect(getTextContent(h.root)).toContain("暂无播放记录");
  expect(findNode(h.root, (node) => node.props.role === "separator")).not.toBeNull();
  h.tracks.value = [
    {
      trackId: 1,
      title: "Song",
      artist: "Artist",
      album: "Album",
      albumArtist: "Artist",
      playCount: 3,
    },
  ];
  await Vue.nextTick();
  expect(getTextContent(h.root)).toContain("Song3");
  expect(findNode(h.root, (node) => node.type === "button")).toBeNull();
  setLocale("en");
  await Vue.nextTick();
  expect(getTextContent(h.root)).toContain("Most played tracks");
  h.visible.value = false;
  await Vue.nextTick();
  expect(findNode(h.root, (node) => node.type === "aside")).toBeNull();
  expect(findNode(h.root, (node) => node.props.role === "separator")).toBeNull();
});
it("resizes from the left edge and persists the dragged width", async () => {
  const h = mount();
  await Vue.nextTick();
  const handle = findNode(h.root, (node) => node.props.role === "separator")!;
  expect(handle.props["aria-valuemin"]).toBe(200);
  expect(handle.props["aria-valuemax"]).toBe(500);
  const start = handle.props.onPointerdown as (event: unknown) => void;
  const move = handle.props.onPointermove as (event: unknown) => void;
  start({
    button: 0,
    pointerId: 1,
    clientX: 600,
    currentTarget: new HandleElement(),
    preventDefault() {},
  });
  move({ pointerId: 1, clientX: 500 });
  await Vue.nextTick();
  expect(handle.props["aria-valuenow"]).toBe(340);
  expect(h.stored.get("newbee.library.statistics.width")).toBe("340");
  expect((handle.parent!.props.style as { width: string }).width).toBe("340px");
  move({ pointerId: 1, clientX: 0 });
  await Vue.nextTick();
  expect(handle.props["aria-valuenow"]).toBe(500);
  move({ pointerId: 1, clientX: 1000 });
  await Vue.nextTick();
  expect(handle.props["aria-valuenow"]).toBe(200);
});
it("shows loading and failure states instead of a misleading empty state", async () => {
  const h = mount();
  h.isLoading.value = true;
  await Vue.nextTick();
  expect(getTextContent(h.root)).toContain("正在加载…");
  h.isLoading.value = false;
  h.loadFailed.value = true;
  await Vue.nextTick();
  expect(getTextContent(h.root)).toContain("读取播放统计失败");
  expect(getTextContent(h.root)).not.toContain("暂无播放记录");
});

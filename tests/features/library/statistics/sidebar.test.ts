import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
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
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  setLocale("zh-CN");
});
function mount() {
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
  const renderer = createHostRenderer(createHostNode);
  const app = renderer.createApp({ setup: () => () => Vue.h(component, { albums: [] }) });
  app.mount(root);
  apps.push(app);
  return { root, tracks, visible, isLoading, loadFailed };
}
it("renders a compact noninteractive sidebar and can be hidden", async () => {
  const h = mount();
  expect(getTextContent(h.root)).toContain("暂无播放记录");
  expect(findNode(h.root, (node) => node.type === "aside")!.props.class).toContain("w-60");
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

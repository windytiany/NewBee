import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import type { TrackPlayStatistics } from "@/features/playback-statistics/usePlaybackStatistics";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";
import { createHostRenderer, findNode, getTextContent, visit } from "../../support/hostRenderer";
import type { HostTree } from "../../support/hostRenderer";

class DialogNode implements HostTree<DialogNode> {
  props: Record<string, unknown> = {};
  children: DialogNode[] = [];
  parent: DialogNode | null = null;
  open = false;
  constructor(
    public type: string,
    public text = "",
  ) {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
}
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  setLocale("zh-CN");
});
const output = compileSfc(
  await Bun.file(
    new URL(
      "../../../src/features/playback-statistics/PlaybackStatisticsDialog.vue",
      import.meta.url,
    ),
  ).text(),
  "PlaybackStatisticsDialog.vue",
);

function mount() {
  const tracks = Vue.ref<TrackPlayStatistics[]>([]);
  const isOpen = Vue.ref(false);
  const isLoading = Vue.ref(false);
  const loadFailed = Vue.ref(false);
  const component = evaluateSource<{ default: Vue.Component }>(output, {
    vue: Vue,
    "@lucide/vue": { X: () => Vue.h("svg") },
    "@/features/playback-statistics/usePlaybackStatistics": {
      usePlaybackStatistics: () => ({
        tracks,
        isOpen,
        isLoading,
        loadFailed,
        open: async () => {
          isOpen.value = true;
        },
        close: () => {
          isOpen.value = false;
        },
      }),
    },
  }).default;
  const dialog = Vue.ref<{ show: () => void } | null>(null);
  const renderer = createHostRenderer((type, text) => Vue.markRaw(new DialogNode(type, text)));
  const root = Vue.markRaw(new DialogNode("root"));
  const app = renderer.createApp({ setup: () => () => Vue.h(component, { ref: dialog }) });
  app.mount(root);
  apps.push(app);
  return { root, tracks, isOpen, isLoading, loadFailed, show: () => dialog.value!.show() };
}

it("opens a modal with a scrollable statistics table, all fields and live rows", async () => {
  const h = mount();
  h.show();
  await Vue.nextTick();
  expect(findNode(h.root, (node) => node.type === "dialog")!.open).toBe(true);
  expect(getTextContent(h.root)).toContain("暂无播放统计");
  h.tracks.value = [{ trackId: 1, title: "Song", artist: "Artist", album: "Album", playCount: 2 }];
  await Vue.nextTick();
  const headers: string[] = [];
  visit(h.root, (node) => {
    if (node.type === "th") headers.push(getTextContent(node));
  });
  expect(headers).toEqual(["歌曲名", "歌手", "专辑名", "播放次数"]);
  expect(getTextContent(findNode(h.root, (node) => node.type === "tbody")!)).toBe(
    "SongArtistAlbum2",
  );
  expect(findNode(h.root, (node) => node.type === "table")!.parent!.props.class).toContain(
    "overflow-auto",
  );
  h.tracks.value = [{ trackId: 2, title: null, artist: null, album: null, playCount: 5 }];
  await Vue.nextTick();
  expect(getTextContent(h.root)).toContain("未知曲目未知艺术家未知专辑5");
  const button = findNode(h.root, (node) => node.type === "button")!;
  const click = button.props.onClick;
  if (typeof click !== "function") throw new Error("Missing close handler");
  click();
  expect(h.isOpen.value).toBe(false);
  expect(findNode(h.root, (node) => node.type === "dialog")!.open).toBe(false);
});

it("shows loading, retains rows after refresh failure and translates labels", async () => {
  const h = mount();
  h.show();
  h.isLoading.value = true;
  await Vue.nextTick();
  expect(getTextContent(h.root)).toContain("正在加载…");
  h.isLoading.value = false;
  h.tracks.value = [{ trackId: 1, title: "Song", artist: "Artist", album: "Album", playCount: 3 }];
  h.loadFailed.value = true;
  await Vue.nextTick();
  expect(findNode(h.root, (node) => node.props.role === "alert")).toBeNull();
  expect(getTextContent(h.root)).toContain("SongArtistAlbum3");
  setLocale("en");
  await Vue.nextTick();
  expect(getTextContent(h.root)).toContain("Playback statistics");
  expect(getTextContent(h.root)).toContain("Play count");
  expect(getTextContent(h.root)).toContain("TitleArtistAlbum");
});

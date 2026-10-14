import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import type { PlaybackTrack } from "@/features/playback/types";
import type { AlbumBackground } from "@/features/artwork/background";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import { createHostRenderer, findNode, visit } from "../../../support/host/renderer";
import type { HostTree } from "../../../support/host/renderer";

interface HostNode extends HostTree<HostNode> {
  type: string;
  style: { display: string };
}
function createNode(type: string, text = ""): HostNode {
  return { type, text, props: {}, children: [], parent: null, style: { display: "" } };
}
const source = await Bun.file(
  new URL("../../../../src/features/playback/pages/NowPlayingPage.vue", import.meta.url),
).text();
const apps: Vue.App[] = [];
const pendingLeaves: Array<() => void> = [];
const transition = Vue.defineComponent({
  inheritAttrs: false,
  setup:
    (_props, { attrs, slots }) =>
    () =>
      Vue.h(
        Vue.BaseTransition,
        {
          ...attrs,
          onLeave: (_element: unknown, done: () => void) => pendingLeaves.push(done),
        },
        slots,
      ),
});
function finishLeaves() {
  for (const finish of pendingLeaves.splice(0)) finish();
}
afterEach(() => {
  finishLeaves();
  for (const app of apps.splice(0)) app.unmount();
});
function mountPage(enabled = true) {
  const preference = Vue.ref(enabled);
  const currentTrack = Vue.ref<PlaybackTrack | null>({
    trackId: 1,
    path: "external.flac",
    title: "Song",
    artist: null,
  });
  const requests: Array<{ trackId: number; resolve: (value: string | null) => void }> = [];
  const presentation = Vue.ref("track");
  const placeholder = Vue.defineComponent(() => () => Vue.h("div"));
  const { default: Page } = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "src/features/playback/pages/NowPlayingPage.vue"),
    {
      vue: { ...Vue, Transition: transition },
      "@lucide/vue": { Columns2: placeholder, DiscAlbum: placeholder, ListMusic: placeholder },
      "@tauri-apps/api/core": { invoke: () => Promise.resolve(null) },
      "@/features/playback/session": {
        usePlaybackSession: () => ({
          state: { currentTrack, playbackStatus: Vue.ref(null), isSeeking: Vue.ref(false) },
        }),
      },
      "@/features/settings/composables/useCoverBackground": {
        useCoverBackground: () => Vue.readonly(preference),
      },
      "@/features/artwork/useTrackArtwork": {
        useTrackArtwork(selection: () => number | null, size: number, purpose: string) {
          expect(size).toBe(32);
          expect(purpose).toBe("background");
          const background = Vue.shallowRef<AlbumBackground | null>(null);
          const status = Vue.ref("fallback");
          let generation = 0;
          Vue.watch(
            selection,
            (trackId) => {
              const current = ++generation;
              background.value = null;
              status.value = trackId === null ? "fallback" : "loading";
              if (trackId === null) return;
              requests.push({
                trackId,
                resolve(value) {
                  if (generation !== current) return;
                  background.value =
                    value === null
                      ? null
                      : { imageUrl: `data:image/png;base64,${value}`, color: "rgb(10, 20, 30)" };
                  status.value = value === null ? "fallback" : "ready";
                },
              });
            },
            { immediate: true, flush: "sync" },
          );
          return { background, status };
        },
      },
      "@/features/playback/current/useDisplayMode": { useDisplayMode: () => ({ presentation }) },
      "@/features/lyrics/composables/useLyrics": {
        useLyrics: () => ({
          retry() {},
          state: Vue.ref({ status: "idle" }),
          activeIndex: Vue.ref(-1),
          activeGroupStartIndex: Vue.ref(-1),
        }),
      },
      "@/features/lyrics/seek": { canSeekLyrics: () => false, seekToLyric: async () => false },
      "@/features/lyrics/components/LyricsView.vue": placeholder,
      "@/features/playback/current/TrackPresentation.vue": placeholder,
    },
  );
  const renderer = createHostRenderer(createNode);
  const root = createNode("root");
  const app = renderer.createApp(Page);
  app.mount(root);
  apps.push(app);
  const page = findNode(root, (node) => node.props["aria-label"] === "正在播放");
  if (!page) throw new Error("Missing playing page");
  function layers() {
    const result: HostNode[] = [];
    visit(root, (node) => {
      if (node.props["aria-hidden"] === "true" && String(node.props.class).includes("bg-cover"))
        result.push(node);
    });
    return result;
  }
  return { page, layers, preference, currentTrack, requests, presentation };
}
async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
}
function backgrounds(page: ReturnType<typeof mountPage>) {
  return JSON.stringify(page.layers().map((layer) => layer.props.style));
}
describe("播放页曲目封面背景", () => {
  it("关闭设置时不请求背景，开启后库外歌曲在三种布局均显示自己的封面背景", async () => {
    const page = mountPage(false);
    await settle();
    expect(page.requests).toEqual([]);
    expect(page.layers()).toEqual([]);
    page.preference.value = true;
    await settle();
    expect(page.requests.map(({ trackId }) => trackId)).toEqual([1]);
    expect(page.layers()).toEqual([]);
    page.requests[0]!.resolve("External cover");
    for (const mode of ["track", "lyrics", "both"]) {
      page.presentation.value = mode;
      await settle();
      expect(backgrounds(page)).toContain("External cover");
      expect(page.layers()[0]?.props.class).toContain("pointer-events-none");
      expect(page.page.props.class).toContain("[--app-muted:#e5e7eb]");
    }
  });
  it("切歌时保留旧背景，封面加载完成后交叉过渡", async () => {
    const page = mountPage();
    page.requests[0]!.resolve("First cover");
    await settle();
    const layer = page.layers()[0];
    page.currentTrack.value = { trackId: 2, title: null, artist: null };
    await settle();
    expect(page.layers()).toEqual([layer]);
    expect(pendingLeaves).toHaveLength(0);
    page.requests[1]!.resolve("Second cover");
    await settle();
    expect(page.layers()).toHaveLength(2);
    expect(backgrounds(page)).toContain("First cover");
    expect(backgrounds(page)).toContain("Second cover");
    finishLeaves();
    await settle();
    expect(page.layers()).toHaveLength(1);
    expect(backgrounds(page)).not.toContain("First cover");
  });
  it("相同封面不重复过渡，不同曲目按各自封面显示", async () => {
    const page = mountPage();
    page.requests[0]!.resolve("Cover");
    await settle();
    const layer = page.layers()[0];
    page.currentTrack.value = { trackId: 2, title: null, artist: null };
    await settle();
    page.requests[1]!.resolve("Cover");
    await settle();
    expect(page.layers()).toEqual([layer]);
    expect(pendingLeaves).toHaveLength(0);
  });
  it("连续切歌不接受迟到的旧封面", async () => {
    const page = mountPage();
    page.requests[0]!.resolve("First");
    await settle();
    page.currentTrack.value = { trackId: 2, title: null, artist: null };
    await settle();
    page.currentTrack.value = { trackId: 3, title: null, artist: null };
    await settle();
    page.requests[1]!.resolve("Second");
    await settle();
    expect(backgrounds(page)).toContain("First");
    expect(backgrounds(page)).not.toContain("Second");
    page.requests[2]!.resolve("Third");
    await settle();
    finishLeaves();
    await settle();
    expect(backgrounds(page)).toContain("Third");
    expect(page.layers()).toHaveLength(1);
  });
  it("关闭设置后未完成的请求不能恢复背景", async () => {
    const page = mountPage();
    page.requests[0]!.resolve("First");
    await settle();
    page.currentTrack.value = { trackId: 2, title: null, artist: null };
    await settle();
    page.preference.value = false;
    await settle();
    page.requests[1]!.resolve("Second");
    await settle();
    finishLeaves();
    await settle();
    expect(page.layers()).toEqual([]);
    expect(page.page.props.class).not.toContain("[--app-muted:");
  });
  it("无封面或无当前歌曲时回退默认背景", async () => {
    const page = mountPage();
    page.requests[0]!.resolve("First");
    await settle();
    page.currentTrack.value = { trackId: 2, title: null, artist: null };
    await settle();
    expect(page.layers()).toHaveLength(1);
    page.requests[1]!.resolve(null);
    await settle();
    finishLeaves();
    await settle();
    expect(page.layers()).toEqual([]);
    page.currentTrack.value = { trackId: 3, title: null, artist: null };
    await settle();
    page.requests[2]!.resolve("Third");
    await settle();
    page.currentTrack.value = null;
    await settle();
    finishLeaves();
    await settle();
    expect(page.layers()).toEqual([]);
  });
});

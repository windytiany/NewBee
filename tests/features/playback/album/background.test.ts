import { afterEach, describe, expect, it } from "bun:test";
import { setLocale } from "@/shared/i18n/locale";
import * as Vue from "vue";
import type { PlaybackTrack } from "@/features/playback/types";

import type { TrackDetails } from "@/features/tracks/types";
import type { AlbumArtworkSelection } from "@/features/artwork/useAlbumArtwork";
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
afterEach(() => {
  finishLeaves();
  for (const app of apps.splice(0)) app.unmount();
  setLocale("zh-CN");
});

function finishLeaves() {
  for (const finish of pendingLeaves.splice(0)) finish();
}

function details(id: number, album: string, albumArtist = "Album artist"): TrackDetails {
  return {
    id,
    path: `${id}.flac`,
    title: "Song",
    artist: "Track artist",
    album,
    albumArtist,
    releaseDate: null,
    discNumber: null,
    trackNumber: null,
    discTotal: null,
    trackTotal: null,
    durationMs: null,
    codec: null,
    sampleRateHz: null,
    bitrateKbps: null,
    channels: null,
  };
}

function mountPage(enabled = false) {
  const preference = Vue.ref(enabled);
  const currentTrack = Vue.ref<PlaybackTrack | null>({
    trackId: 1,
    title: "Song",
    artist: "Track artist",
  });
  const requests: Array<{ trackId: number; resolve: (value: TrackDetails | null) => void }> = [];
  const selections: Array<AlbumArtworkSelection | null> = [];
  const missingArtwork = Vue.ref(false);
  const artworkLoading = Vue.ref(false);
  const presentation = Vue.ref("track");
  const placeholder = Vue.defineComponent(() => () => Vue.h("div"));
  const { default: Page } = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "src/features/playback/pages/NowPlayingPage.vue"),
    {
      vue: { ...Vue, Transition: transition },
      "@lucide/vue": { Columns2: placeholder, DiscAlbum: placeholder, ListMusic: placeholder },
      "@tauri-apps/api/core": {
        invoke: (command: string, args: { trackId: number }) => {
          expect(command).toBe("get_track");
          return new Promise<TrackDetails | null>((resolve) => {
            requests.push({ trackId: args.trackId, resolve });
          });
        },
      },
      "@/features/playback/session": {
        usePlaybackSession: () => ({
          state: { currentTrack, playbackStatus: Vue.ref(null), isSeeking: Vue.ref(false) },
        }),
      },
      "@/features/settings/composables/useCoverBackground": {
        useCoverBackground: (setting: string) => {
          expect(setting).toBe("playingCoverBackground");
          return Vue.readonly(preference);
        },
      },
      "@/features/artwork/useAlbumArtwork": {
        useAlbumArtwork(selection: () => AlbumArtworkSelection | null, purpose: string) {
          expect(purpose).toBe("background");
          Vue.watch(selection, (value) => selections.push(value), { immediate: true });
          return {
            status: Vue.computed(() =>
              selection() && artworkLoading.value
                ? "loading"
                : selection() && !missingArtwork.value
                  ? "ready"
                  : "fallback",
            ),
            background: Vue.computed(() => {
              const album = selection();
              return album && !missingArtwork.value && !artworkLoading.value
                ? { imageUrl: `data:image/png;base64,${album.album}`, color: "rgb(10, 20, 30)" }
                : null;
            }),
          };
        },
      },
      "@/features/playback/current/useDisplayMode": {
        useDisplayMode: () => ({ presentation }),
      },
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
  return {
    page,
    layers,
    preference,
    currentTrack,
    requests,
    selections,
    missingArtwork,
    artworkLoading,
    presentation,
  };
}

async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
}

function backgroundImages(page: ReturnType<typeof mountPage>) {
  return page.layers().map((layer) => layer.props.style);
}

describe("播放页专辑封面背景", () => {
  it("设置关闭时使用默认背景，不请求用于背景的曲目详情", async () => {
    const page = mountPage();
    await settle();
    expect(page.requests).toEqual([]);
    expect(page.selections).toEqual([null]);
    expect(page.layers()).toEqual([]);
  });

  it("首次背景加载期间不显示背景，三种布局均使用生成的专辑背景", async () => {
    const page = mountPage();
    page.preference.value = true;
    await settle();
    expect(page.requests.map(({ trackId }) => trackId)).toEqual([1]);
    expect(page.layers()).toEqual([]);
    page.requests[0]!.resolve(details(1, "First album"));
    await settle();
    expect(page.selections[page.selections.length - 1]).toEqual({
      albumArtist: "Album artist",
      album: "First album",
    });
    for (const mode of ["track", "lyrics", "both"]) {
      page.presentation.value = mode;
      await settle();
      expect(backgroundImages(page)).toEqual([
        {
          backgroundImage:
            'linear-gradient(to bottom, rgb(10, 20, 30), transparent 48px), url("data:image/png;base64,First album")',
        },
      ]);
      expect(page.layers()[0]?.props.class).toContain("pointer-events-none");
      expect(page.page.props.class).toContain("h-full");
      expect(page.page.props.class).toContain("w-full");
      expect(page.page.props.class).toContain("[--app-muted:#e5e7eb]");
    }
  });

  it("切歌时保留旧背景，等待详情与新背景完成后两层同时过渡", async () => {
    const page = mountPage(true);
    page.requests[0]!.resolve(details(1, "First album"));
    await settle();
    const oldLayer = page.layers()[0];
    page.currentTrack.value = { trackId: 2, title: "New song", artist: null };
    await settle();
    expect(page.layers()).toEqual([oldLayer]);
    expect(JSON.stringify(backgroundImages(page))).toContain("First album");
    expect(page.page.props.class).toContain("[--app-muted:#e5e7eb]");
    expect(pendingLeaves).toHaveLength(0);

    page.artworkLoading.value = true;
    page.requests[1]!.resolve(details(2, "Second album"));
    await settle();
    expect(page.layers()).toEqual([oldLayer]);
    expect(pendingLeaves).toHaveLength(0);

    page.artworkLoading.value = false;
    await settle();
    expect(page.layers()).toHaveLength(2);
    expect(JSON.stringify(backgroundImages(page))).toContain("First album");
    expect(JSON.stringify(backgroundImages(page))).toContain("Second album");
    expect(pendingLeaves).toHaveLength(1);

    finishLeaves();
    await settle();
    expect(page.layers()).toHaveLength(1);
    expect(JSON.stringify(backgroundImages(page))).toContain("Second album");
    expect(JSON.stringify(backgroundImages(page))).not.toContain("First album");
  });

  it("同专辑切歌不移除背景或启动重复过渡", async () => {
    const page = mountPage(true);
    page.requests[0]!.resolve(details(1, "Album"));
    await settle();
    const layer = page.layers()[0];
    page.currentTrack.value = { trackId: 2, title: "New song", artist: null };
    await settle();
    page.requests[1]!.resolve(details(2, "Album"));
    await settle();
    expect(page.layers()).toEqual([layer]);
    expect(pendingLeaves).toHaveLength(0);
  });

  it("连续切歌保留当前背景，迟到的旧详情不会切回中间专辑", async () => {
    const page = mountPage(true);
    page.requests[0]!.resolve(details(1, "First album"));
    await settle();
    page.currentTrack.value = { trackId: 2, title: null, artist: null };
    await settle();
    page.currentTrack.value = { trackId: 3, title: null, artist: null };
    await settle();
    page.requests[1]!.resolve(details(2, "Second album"));
    await settle();
    expect(JSON.stringify(backgroundImages(page))).toContain("First album");
    expect(JSON.stringify(backgroundImages(page))).not.toContain("Second album");
    page.requests[2]!.resolve(details(3, "Third album"));
    await settle();
    expect(JSON.stringify(backgroundImages(page))).toContain("Third album");
    finishLeaves();
    await settle();
    expect(page.layers()).toHaveLength(1);
    expect(JSON.stringify(backgroundImages(page))).toContain("Third album");
  });

  it("关闭设置后淡出背景，未完成的请求不会重新显示背景", async () => {
    const page = mountPage(true);
    page.requests[0]!.resolve(details(1, "Album"));
    await settle();
    page.currentTrack.value = { trackId: 2, title: null, artist: null };
    await settle();
    page.preference.value = false;
    await settle();
    expect(pendingLeaves).toHaveLength(1);
    expect(page.page.props.class).not.toContain("[--app-muted:");
    page.requests[1]!.resolve(details(2, "New album"));
    await settle();
    finishLeaves();
    await settle();
    expect(page.layers()).toEqual([]);
    expect(page.selections[page.selections.length - 1]).toBeNull();
  });

  it("确认无封面、无详情或无当前歌曲时回退到默认背景", async () => {
    const page = mountPage(true);
    page.requests[0]!.resolve(details(1, "Album"));
    await settle();
    page.missingArtwork.value = true;
    await settle();
    finishLeaves();
    await settle();
    expect(page.layers()).toEqual([]);
    page.missingArtwork.value = false;
    await settle();
    expect(page.layers()).toHaveLength(1);
    page.currentTrack.value = { trackId: 2, title: null, artist: null };
    await settle();
    expect(page.layers()).toHaveLength(1);
    page.requests[1]!.resolve(null);
    await settle();
    finishLeaves();
    await settle();
    expect(page.layers()).toEqual([]);
    page.currentTrack.value = null;
    await settle();
    expect(page.selections[page.selections.length - 1]).toBeNull();
    expect(page.layers()).toEqual([]);
  });
});

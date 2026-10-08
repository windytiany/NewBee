import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import type { NowPlayingTrack } from "@/features/playback/types";
import type { TrackDetails } from "@/features/library/types";
import type { AlbumArtworkSelection } from "@/features/artwork/useAlbumArtwork";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";
import { createHostRenderer, findNode } from "../../support/hostRenderer";
import type { HostTree } from "../../support/hostRenderer";

interface HostNode extends HostTree<HostNode> {
  type: string;
  style: { display: string };
}

function createNode(type: string, text = ""): HostNode {
  return { type, text, props: {}, children: [], parent: null, style: { display: "" } };
}

const source = await Bun.file(
  new URL("../../../src/features/playback/pages/NowPlayingPage.vue", import.meta.url),
).text();
const apps: Vue.App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});

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
  const currentTrack = Vue.ref<NowPlayingTrack | null>({
    trackId: 1,
    title: "Song",
    artist: "Track artist",
    playbackId: 1,
  });
  const requests: Array<{ trackId: number; resolve: (value: TrackDetails | null) => void }> = [];
  const selections: Array<AlbumArtworkSelection | null> = [];
  const missingArtwork = Vue.ref(false);
  const presentation = Vue.ref("track");
  const placeholder = Vue.defineComponent(() => () => Vue.h("div"));
  const { default: Page } = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "src/features/playback/pages/NowPlayingPage.vue"),
    {
      vue: Vue,
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
            background: Vue.computed(() => {
              const album = selection();
              return album && !missingArtwork.value
                ? { imageUrl: `data:image/png;base64,${album.album}`, color: "rgb(10, 20, 30)" }
                : null;
            }),
          };
        },
      },
      "@/features/playback/composables/useDisplayMode": {
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
      "@/features/playback/components/current-track/TrackPresentation.vue": placeholder,
    },
  );
  const renderer = createHostRenderer(createNode);
  const root = createNode("root");
  const app = renderer.createApp(Page);
  app.mount(root);
  apps.push(app);
  const page = findNode(root, (node) => node.props["aria-label"] === "Now playing");
  const layer = findNode(root, (node) => node.props["aria-hidden"] === "true");
  if (!page || !layer) throw new Error("Missing playing background layer");
  return {
    page,
    layer,
    preference,
    currentTrack,
    requests,
    selections,
    missingArtwork,
    presentation,
  };
}

async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
}

describe("播放页专辑封面背景", () => {
  it("设置关闭时使用默认背景，不请求用于背景的曲目详情", async () => {
    const page = mountPage();
    await settle();
    expect(page.requests).toEqual([]);
    expect(page.selections).toEqual([null]);
    expect(page.layer.props.style).toEqual({ backgroundImage: undefined });
    expect(page.layer.props.class).toContain("opacity-0");
  });

  it("打开设置后使用专辑艺术家和专辑加载背景，三种布局均显示背景", async () => {
    const page = mountPage();
    page.preference.value = true;
    await settle();
    expect(page.requests.map(({ trackId }) => trackId)).toEqual([1]);
    page.requests[0]!.resolve(details(1, "First album"));
    await settle();
    expect(page.selections[page.selections.length - 1]).toEqual({
      albumArtist: "Album artist",
      album: "First album",
    });
    for (const mode of ["track", "lyrics", "both"]) {
      page.presentation.value = mode;
      await settle();
      expect(page.layer.props.style).toEqual({
        backgroundImage:
          'linear-gradient(to bottom, rgb(10, 20, 30), transparent 48px), url("data:image/png;base64,First album")',
      });
      expect(page.layer.props.class).toContain("opacity-100");
      expect(page.layer.props.class).toContain("pointer-events-none");
      expect(page.page.props.class).toContain("h-full");
      expect(page.page.props.class).toContain("w-full");
      expect(page.page.props.class).toContain("[--app-muted:#e5e7eb]");
    }
  });

  it("切歌立即清除旧背景，迟到的旧详情不会覆盖新专辑", async () => {
    const page = mountPage(true);
    page.currentTrack.value = { trackId: 2, title: "New song", artist: null, playbackId: 2 };
    await settle();
    expect(page.requests.map(({ trackId }) => trackId)).toEqual([1, 2]);
    page.requests[1]!.resolve(details(2, "Second album"));
    await settle();
    page.requests[0]!.resolve(details(1, "First album"));
    await settle();
    expect(page.selections[page.selections.length - 1]?.album).toBe("Second album");
    expect(JSON.stringify(page.layer.props.style)).toContain("Second album");
    page.currentTrack.value = { trackId: 3, title: "Third song", artist: null, playbackId: 3 };
    await settle();
    expect(page.layer.props.style).toEqual({ backgroundImage: undefined });
  });

  it("关闭设置立即移除背景，未完成的查询不会重新显示背景", async () => {
    const page = mountPage(true);
    page.requests[0]!.resolve(details(1, "Album"));
    await settle();
    page.preference.value = false;
    await settle();
    expect(page.layer.props.style).toEqual({ backgroundImage: undefined });
    expect(page.page.props.class).not.toContain("[--app-muted:");
    page.preference.value = true;
    await settle();
    page.preference.value = false;
    page.requests[1]!.resolve(details(1, "Album"));
    await settle();
    expect(page.layer.props.style).toEqual({ backgroundImage: undefined });
    expect(page.selections[page.selections.length - 1]).toBeNull();
  });

  it("无封面、无详情或无当前歌曲时回退到默认背景", async () => {
    const page = mountPage(true);
    page.requests[0]!.resolve(details(1, "Album"));
    await settle();
    page.missingArtwork.value = true;
    await settle();
    expect(page.layer.props.style).toEqual({ backgroundImage: undefined });
    page.missingArtwork.value = false;
    page.currentTrack.value = { trackId: 2, title: null, artist: null, playbackId: 2 };
    await settle();
    page.requests[1]!.resolve(null);
    await settle();
    expect(page.layer.props.style).toEqual({ backgroundImage: undefined });
    page.currentTrack.value = null;
    await settle();
    expect(page.selections[page.selections.length - 1]).toBeNull();
    expect(page.layer.props.style).toEqual({ backgroundImage: undefined });
  });
});

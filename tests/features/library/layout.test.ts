import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import { createHostNode, createHostRenderer, findNode } from "../../support/host/renderer";

const source = await Bun.file(
  new URL("../../../src/features/library/browser/albums/AlbumDetail.vue", import.meta.url),
).text();
const placeholder = Vue.defineComponent({ render: () => null });
const passive = { __esModule: true, default: placeholder };
const dependencies: Record<string, unknown> = {
  vue: Vue,
  "@lucide/vue": {
    ChevronRight: placeholder,
    Pause: placeholder,
    Play: placeholder,
    X: placeholder,
  },
  "@/shared/i18n/locale": { t: (text: string) => text },
  "@/shared/interaction/useContextMenu": {
    useContextMenu: () => ({
      request: Vue.ref(null),
      position: Vue.ref({ x: 0, y: 0 }),
      close() {},
    }),
  },
  "@/shared/interaction/item/useSelection": {
    useItemSelection: () => ({ syncVisibleItems() {}, isSelected: () => false }),
  },
  "@/shared/interaction/item/keyboard": { createItemKeyboard: () => ({}) },
  "@/features/shortcuts/context": { useContextCommands() {} },
  "@/features/library/browser/albums/useTrackColumns": { useTrackColumns: () => Vue.ref(2) },
};
for (const path of [
  "features/library/browser/albums/AlbumTrack.vue",
  "features/playback/queue/SkipMenuItem.vue",
  "features/metadata/tracks/UpdateMenuItem.vue",
  "features/tracks/presentation/RereadMenuItem.vue",
  "features/metadata/replaygain/AnalysisMenuItem.vue",
  "features/metadata/replaygain/RemovalMenuItem.vue",
  "features/metadata/manual/EditMenuItem.vue",
  "features/lyrics/download/DownloadMenuItem.vue",
  "features/metadata/releases/ReleaseMenuItem.vue",
])
  dependencies[`@/${path}`] = passive;
const { default: AlbumDetail } = evaluateSource<{ default: Vue.Component }>(
  compileSfc(source, "AlbumDetail.vue"),
  dependencies,
);
const apps: Vue.App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});

it("preserves the previous detail height while replacement tracks load and releases it on completion", async () => {
  const tracks = [{ id: 1, title: "Track", artist: "Artist", album: "Album", durationMs: 100 }];
  const state = Vue.reactive({ tracks, tracksLoading: false, tracksError: "" });
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(AlbumDetail, {
        album: { albumArtist: "Artist", album: "Album", year: 2024 },
        albumArtist: "Artist",
        currentTrackId: null,
        isPlaying: false,
        playbackCommandPending: false,
        playlists: [],
        playlistsLoading: false,
        playlistsError: "",
        trackActionPending: false,
        ...state,
      }),
  });
  app.mount(root);
  apps.push(app);
  const detail = findNode(root, (node) => node.type === "article");
  if (!detail) throw new Error("Missing album detail");
  let height = 480;
  Object.assign(detail, {
    getBoundingClientRect: () => ({
      height: findNode(detail, (node) => node.type === "ol") ? height : 120,
    }),
  });

  for (const error of ["", "读取曲目失败"]) {
    state.tracks = [];
    state.tracksLoading = true;
    await Vue.nextTick();
    expect(detail.props.style).toMatchObject({ minHeight: `${height}px` });
    expect(findNode(root, (node) => node.type === "article")).toBe(detail);

    state.tracksError = error;
    state.tracks = tracks;
    state.tracksLoading = false;
    await Vue.nextTick();
    expect(detail.props.style).toMatchObject({ minHeight: undefined });
    height = 240;
  }
});

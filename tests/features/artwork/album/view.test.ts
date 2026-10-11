import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { loadSourceModules } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  visit,
} from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";
import type { AlbumArtworkSelection } from "@/features/artwork/useAlbumArtwork";
import type { AlbumBackground } from "@/features/artwork/background";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const apps: Array<{ unmount: () => void }> = [];
const background = Vue.shallowRef<AlbumBackground | null>(null);
const artworkError = Vue.ref("");
const backgroundEnabled = Vue.ref(true);
const backgroundSelections: Array<Vue.MaybeRefOrGetter<AlbumArtworkSelection | null>> = [];
const icon = Vue.defineComponent(() => () => null);
const passiveComponent = { __esModule: true, default: icon };
const dependencies: Record<string, unknown> = {
  vue: Vue,
  "@lucide/vue": { ChevronRight: icon, Play: icon, Pause: icon, X: icon, DiscAlbum: icon },
  "@/features/settings/composables/useCoverBackground": {
    useCoverBackground: (setting: string) => {
      expect(setting).toBe("albumCoverBackground");
      return backgroundEnabled;
    },
  },
  "@/features/artwork/background": { ALBUM_BACKGROUND_SAMPLE_SIZE: 32 },
  "@/features/artwork/useArtworkSize": { useArtworkSize: () => Vue.ref(160) },
  "@/features/artwork/useAlbumArtwork": {
    useAlbumArtwork(
      selection: Vue.MaybeRefOrGetter<AlbumArtworkSelection | null>,
      purpose: "cover" | "background",
    ) {
      if (purpose === "background") backgroundSelections.push(selection);
      return {
        status: Vue.ref("fallback"),
        url: Vue.ref(null),
        background: Vue.computed(() =>
          Vue.toValue(selection) && purpose === "background" ? background.value : null,
        ),
        error: Vue.computed(() => (Vue.toValue(selection) ? artworkError.value : "")),
      };
    },
  },
  "@/shared/interaction/item/useSelection": {
    useItemSelection: () => ({
      syncVisibleItems() {},
      isFocused: () => false,
      isSelected: () => false,
      focusItem() {},
      selectItem() {},
      contextMenuTargets: (key: string) => [key],
    }),
  },
  "@/shared/interaction/useContextMenu": {
    useContextMenu: () => {
      const request = Vue.ref(null);
      return {
        request,
        position: Vue.ref({ x: 10, y: 20 }),
        open: (value: null) => (request.value = value),
        close: () => (request.value = null),
      };
    },
  },
  "@/features/library/browser/albums/useTrackColumns": { useTrackColumns: () => Vue.ref(2) },
  "@/features/library/browser/albums/AlbumTrack.vue": {
    __esModule: true,
    default: Vue.defineComponent({
      props: ["track"],
      emits: ["contextMenu"],
      setup:
        (props, { emit }) =>
        () =>
          Vue.h("button", {
            "data-track-id": props.track.id,
            onContextmenu: () =>
              emit("contextMenu", { trackId: props.track.id, x: 10, y: 20, trigger: null }),
          }),
    }),
  },
  "@/features/metadata/manual/components/EditMenuItem.vue": passiveComponent,
  "@/features/lyrics/download/DownloadMenuItem.vue": passiveComponent,
  "@/features/playback/queue/components/SkipMenuItem.vue": passiveComponent,
  "@/features/library/browser/albums/AlbumContextMenu.vue": passiveComponent,
  "@/features/playlist/creation/CreatePlaylistDialog.vue": passiveComponent,
  "@/features/library/api": {
    createLibraryApi: () => ({ listAlbumTracks: async () => [] }),
  },
};
await loadSourceModules(
  [
    "features/library/browser/albums/AlbumCard.vue",
    "features/library/browser/albums/AlbumDetail.vue",
    "features/library/browser/albums/AlbumBrowser.vue",
  ],
  dependencies,
);
const AlbumBrowser = (
  dependencies["@/features/library/browser/albums/AlbumBrowser.vue"] as {
    default: Vue.Component;
  }
).default;
const album = { album: "Album", year: 2024, trackCount: 1 };

function mountBrowser() {
  const renderer = createHostRenderer(createHostNode);
  const root = createHostNode("root");
  const selectedAlbum = Vue.ref<AlbumArtworkSelection | null>({
    albumArtist: "Artist",
    album: "Album",
  });
  const app = renderer.createApp({
    setup: () => () =>
      Vue.h(AlbumBrowser, {
        artist: { albumArtist: "Artist" },
        albums: [album],
        selectedAlbum: selectedAlbum.value,
        tracks: [{ id: 1, title: "Song" }],
        currentTrackId: null,
        isPlaying: false,
        playbackCommandPending: false,
        albumsLoading: false,
        albumsError: "",
        tracksLoading: false,
        tracksError: "",
        playlists: [],
        playlistsLoading: false,
        playlistsError: "",
        trackActionPending: false,
      }),
  });
  app.mount(root);
  apps.push(app);
  return { root, selectedAlbum };
}

function panel(root: HostNode) {
  const node = findNode(
    root,
    (entry) => entry.type === "article" && String(entry.props.class).includes("shadow-xl"),
  );
  if (!node) throw new Error("Missing album detail");
  return node;
}

beforeEach(() => {
  background.value = null;
  artworkError.value = "";
  backgroundEnabled.value = true;
  backgroundSelections.length = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { innerWidth: 1024, addEventListener() {}, removeEventListener() {} },
  });
});

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("专辑背景展示", () => {
  it("关闭设置不请求背景，开关立即更新背景、文字与指示三角", async () => {
    backgroundEnabled.value = false;
    background.value = { imageUrl: "data:image/png;base64,test", color: "rgb(10, 20, 40)" };
    const { root } = mountBrowser();
    const detail = panel(root);
    const selection = backgroundSelections[0];
    if (!selection) throw new Error("Missing background selection");
    expect(Vue.toValue(selection)).toBeNull();
    expect(detail.children[0]?.props.class).toContain("opacity-0");
    expect(detail.props.class).not.toContain("[--app-muted:");
    expect(detail.parent?.props.style).toEqual({ "--album-background-color": undefined });

    backgroundEnabled.value = true;
    await Vue.nextTick();
    expect(Vue.toValue(selection)?.album).toBe("Album");
    expect(detail.children[0]?.props.class).toContain("opacity-100");
    expect(detail.props.class).toContain("[--app-muted:#e5e7eb]");

    backgroundEnabled.value = false;
    await Vue.nextTick();
    expect(Vue.toValue(selection)).toBeNull();
    expect(detail.children[0]?.props.class).toContain("opacity-0");
    expect(detail.props.class).not.toContain("[--app-muted:");
    expect(detail.parent?.props.style).toEqual({ "--album-background-color": undefined });
  });

  it("背景加载前使用默认底色，加载后面板与三角同步颜色", async () => {
    const { root } = mountBrowser();
    const detail = panel(root);
    const decoration = detail.children[0];
    if (!decoration || !detail.parent) throw new Error("Missing background layer");
    expect(detail.props.class).toContain("bg-app-interactive");
    expect(decoration.props.class).toContain("opacity-0");
    background.value = { imageUrl: "data:image/png;base64,test", color: "rgb(10, 20, 40)" };
    await Vue.nextTick();
    expect(decoration.props.class).toContain("opacity-100");
    expect(detail.props.class).toContain("[--app-muted:#e5e7eb]");
    expect(detail.props.class).toContain("[--app-text:#fff]");
    expect(decoration.props.class).toContain("motion-reduce:transition-none");
    expect(decoration.props["aria-hidden"]).toBe("true");
    expect(decoration.props.style).toEqual({
      backgroundImage:
        'linear-gradient(to bottom, rgb(10, 20, 40), transparent 48px), url("data:image/png;base64,test")',
      backgroundSize: "100% 100%",
    });
    expect(detail.parent.props.style).toEqual({ "--album-background-color": "rgb(10, 20, 40)" });
    const pointer = findNode(detail.parent, (node) =>
      String(node.props.class).includes("border-b-12"),
    );
    expect(pointer?.props.style).toEqual({
      gridColumn: 1,
      borderBottomColor: "var(--album-background-color, var(--app-interactive))",
    });
    expect(findNode(detail, (node) => node.type === "header")?.props.class).toContain("relative");
    expect(findNode(detail, (node) => node.type === "ol")?.parent?.props.class).toContain(
      "relative",
    );
  });

  it("背景存在时右键菜单仍为 fixed，所有祖先均不使用模糊、变换或裁剪", async () => {
    background.value = { imageUrl: "data:image/png;base64,test", color: "rgb(10, 20, 40)" };
    const { root } = mountBrowser();
    const track = findNode(root, (node) => node.props["data-track-id"] === 1);
    const handler = track?.props.onContextmenu;
    if (typeof handler !== "function") throw new Error("Missing track context menu");
    handler();
    await Vue.nextTick();
    const menu = findNode(root, (node) => node.props.id === "album-track-context-menu");
    expect(menu?.props.class).toContain("fixed");
    let ancestor = menu?.parent;
    while (ancestor) {
      expect(String(ancestor.props.class)).not.toMatch(/(?:blur|transform|overflow-hidden)/);
      expect(ancestor.props.style).not.toHaveProperty("filter");
      expect(ancestor.props.style).not.toHaveProperty("transform");
      ancestor = ancestor.parent;
    }
  });

  it("生成失败回退，收起专辑移除整个展开区", async () => {
    const { root, selectedAlbum } = mountBrowser();
    artworkError.value = "生成专辑背景失败：Canvas 2D 不可用";
    await Vue.nextTick();
    expect(panel(root).parent?.props.title).toBeUndefined();
    expect(panel(root).children[0]?.props.class).toContain("opacity-0");
    selectedAlbum.value = null;
    await Vue.nextTick();
    const details: HostNode[] = [];
    visit(root, (node) => {
      if (node.type === "article" && String(node.props.class).includes("shadow-xl"))
        details.push(node);
    });
    expect(details).toEqual([]);
  });
});

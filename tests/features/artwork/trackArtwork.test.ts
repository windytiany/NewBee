import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { effectScope, nextTick, ref } from "vue";
import type { Ref } from "vue";
import { compileSfc, loadSourceModules, evaluateSource } from "../../support/moduleLoader";

import { notify } from "@/shared/notifications/center";
import { useNotification } from "@/shared/notifications/useNotification";
import { createHostNode, createHostRenderer } from "../../support/hostRenderer";
import type { HostNode as ArtworkHostNode } from "../../support/hostRenderer";
import type { TrackArtwork } from "@/features/artwork/types";
import type { TrackDetails } from "@/features/library/types";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let artworkRequest: (trackId: number) => Promise<TrackArtwork>;
let detailsRequest: (trackId: number) => Promise<TrackDetails | null>;
let decodeImage: (image: TestImage) => Promise<void>;
let invokedTrackIds: number[];
let invokedArtworkRequests: Array<{ trackId: number; size: number | null }>;
let imageBlobs: Blob[];
let revokedUrls: string[];
let nextObjectUrl: number;
let decodeCount: number;
let imageInstances: TestImage[];
const mountedScopes: Array<{ stop: () => void }> = [];
const mountedApps: Array<{ unmount: () => void }> = [];
const pendingLeaves: Array<() => void> = [];
const testTransition = Vue.defineComponent({
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
const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

class TestImage {
  src = "";

  constructor() {
    imageInstances.push(this);
  }

  decode() {
    return decodeImage(this);
  }

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

const dependencies: Record<string, unknown> = {
  vue: Vue,
  "@/shared/notifications/center": { notify },
  "@/features/library/events": { LIBRARY_CHANGED_EVENT: "newbee:library-changed" },
  "@/shared/notifications/useNotification": { useNotification },
};
dependencies["@tauri-apps/api/core"] = {
  invoke: (command: string, args?: { trackId: number; size: number | null }) => {
    if (!args) throw new Error("Track request is missing its track ID.");
    if (command === "get_track") return detailsRequest(args.trackId);
    invokedTrackIds.push(args.trackId);
    invokedArtworkRequests.push(args);
    return artworkRequest(args.trackId);
  },
};

await loadSourceModules(
  [
    "features/artwork/useTrackArtwork.ts",
    "features/artwork/useTrackArtworkPresentation.ts",
    "features/playback/composables/useTrackDetails.ts",
  ],
  dependencies,
);
const artworkModule = dependencies[
  "@/features/artwork/useTrackArtwork"
] as typeof import("@/features/artwork/useTrackArtwork");
const trackInfoModule = dependencies[
  "@/features/playback/composables/useTrackDetails"
] as typeof import("@/features/playback/composables/useTrackDetails");
const { useTrackArtwork, invalidateTrackArtworkCache } = artworkModule;
const measuredArtworkSize = ref<number | null>(null);
const playingTrack = ref<{ trackId: number; title: string; artist: string } | null>(null);

function createTrackArtworkComponent(
  source: string,
  filename = "src/features/artwork/components/TrackArtwork.vue",
) {
  const output = compileSfc(source, filename, { id: "track-artwork-test" });
  const modules: Record<string, unknown> = {
    vue: { ...Vue, Transition: testTransition },
    "@/features/artwork/useTrackArtwork": artworkModule,
    "@/features/artwork/useTrackArtworkPresentation":
      dependencies["@/features/artwork/useTrackArtworkPresentation"],
    "@/features/artwork/useArtworkSize": { useArtworkSize: () => measuredArtworkSize },
    "@/features/playback/session": {
      usePlaybackSession: () => ({ state: { currentTrack: playingTrack } }),
    },
    "@/features/playback/components/current-track/TrackTransition.vue": {
      __esModule: true,
      get default() {
        return transitionArtworkComponent;
      },
    },
    "@lucide/vue": {
      DiscAlbum: () => Vue.h("span", { "data-test": "fallback" }, "fallback"),
      Disc3: () => Vue.h("span", { "data-test": "fallback" }, "fallback"),
    },
    "@/features/playback/composables/useTrackDetails": trackInfoModule,
  };
  return evaluateSource<{ default: Vue.Component }>(output, modules).default;
}

const trackArtworkComponent = createTrackArtworkComponent(
  await Bun.file(
    new URL("../../../src/features/artwork/components/TrackArtwork.vue", import.meta.url),
  ).text(),
);

const transitionArtworkComponent = createTrackArtworkComponent(
  await Bun.file(
    new URL(
      "../../../src/features/playback/components/current-track/TrackTransition.vue",
      import.meta.url,
    ),
  ).text(),
  "src/features/playback/components/current-track/TrackTransition.vue",
);

const presentationArtworkComponent = createTrackArtworkComponent(
  await Bun.file(
    new URL(
      "../../../src/features/playback/components/current-track/TrackPresentation.vue",
      import.meta.url,
    ),
  ).text(),
  "src/features/playback/components/current-track/TrackPresentation.vue",
);

const infoArtworkComponent = createTrackArtworkComponent(
  await Bun.file(
    new URL(
      "../../../src/features/playback/components/current-track/TrackInfoPanel.vue",
      import.meta.url,
    ),
  ).text(),
  "src/features/playback/components/current-track/TrackInfoPanel.vue",
);

function createDetails(trackId: number): TrackDetails {
  return {
    id: trackId,
    path: `/music/${trackId}.mp3`,
    title: `Title ${trackId}`,
    artist: `Artist ${trackId}`,
    album: `Album ${trackId}`,
    albumArtist: null,
    releaseDate: null,
    discNumber: null,
    trackNumber: null,
    discTotal: null,
    trackTotal: null,
    durationMs: 180_000,
    codec: "mp3",
    sampleRateHz: 44_100,
    bitrateKbps: 320,
    channels: 2,
  };
}

function mountArtwork(trackId: Ref<number | null> | number) {
  let artwork!: ReturnType<typeof useTrackArtwork>;
  const scope = effectScope();
  scope.run(() => {
    artwork = useTrackArtwork(trackId);
  });
  mountedScopes.push(scope);
  return { artwork, dispose: () => scope.stop() };
}

async function settleArtwork() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
}

function mountArtworkComponent(
  trackId: Ref<number | null>,
  component: Vue.Component = trackArtworkComponent,
) {
  const renderer = createHostRenderer(createHostNode, {
    createElement: (type) => {
      const node = createHostNode(type);
      return Object.assign(node, {
        getAttribute: (name: string) => node.props[name] ?? null,
      });
    },
  });
  const root: ArtworkHostNode = { type: "root", props: {}, children: [], parent: null, text: "" };
  const app = renderer.createApp({
    setup: () => () =>
      Vue.h(
        component,
        component === trackArtworkComponent
          ? { trackId: trackId.value, alt: "cover" }
          : {
              track:
                trackId.value === null
                  ? null
                  : {
                      trackId: trackId.value,
                      title: `Queue ${trackId.value}`,
                      artist: `Queue artist ${trackId.value}`,
                    },
            },
        component === trackArtworkComponent
          ? { default: () => Vue.h("span", { "data-test": "fallback" }, "fallback") }
          : {
              default: (snapshot: {
                track: { title: string | null } | null;
                details: TrackDetails | null;
                artworkUrl: string | null;
                artworkStatus: string;
                detailsError: string;
              }) => [
                Vue.h("h1", snapshot.details?.title ?? snapshot.track?.title ?? ""),
                Vue.h("p", snapshot.details?.album ?? ""),
                Vue.h("div", { "data-test": "details-error" }, snapshot.detailsError),
                snapshot.artworkUrl
                  ? Vue.h("img", { src: snapshot.artworkUrl })
                  : snapshot.artworkStatus === "fallback"
                    ? Vue.h("span", { "data-test": "fallback" }, "fallback")
                    : null,
              ],
            },
      ),
  });
  app.mount(root);
  mountedApps.push(app);
  return root;
}

function findArtworkNode(root: ArtworkHostNode, type: string): ArtworkHostNode | null {
  if (root.type === type) return root;
  for (const child of root.children) {
    const match = findArtworkNode(child, type);
    if (match) return match;
  }
  return null;
}

beforeEach(() => {
  measuredArtworkSize.value = null;
  playingTrack.value = null;
  invokedTrackIds = [];
  invokedArtworkRequests = [];
  imageBlobs = [];
  revokedUrls = [];
  nextObjectUrl = 0;
  decodeCount = 0;
  imageInstances = [];
  artworkRequest = async (trackId) =>
    new Uint8Array([trackId & 0xff, (trackId >>> 8) & 0xff]).buffer;
  detailsRequest = async (trackId) => createDetails(trackId);
  decodeImage = async () => {};
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: (blob: Blob) => {
      imageBlobs.push(blob);
      return `blob:artwork-${++nextObjectUrl}`;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revokedUrls.push(url),
  });
});

afterEach(() => {
  for (const finish of pendingLeaves.splice(0)) finish();
  for (const app of mountedApps.splice(0)) app.unmount();
  for (const scope of mountedScopes.splice(0)) scope.stop();
  for (const [target, key, descriptor] of [
    [globalThis, "Image", originalImage],
    [URL, "createObjectURL", originalCreateObjectURL],
    [URL, "revokeObjectURL", originalRevokeObjectURL],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});

describe("播放封面与元数据同步过渡", () => {
  it("相同封面切歌原位更新信息，不重播过渡或替换正在显示的图片", async () => {
    artworkRequest = async () => new Uint8Array([4, 5, 6]).buffer;
    const source = ref<number | null>(121);
    const root = mountArtworkComponent(source, transitionArtworkComponent);
    await settleArtwork();
    const image = findArtworkNode(root, "img");
    const title = findArtworkNode(root, "h1");

    source.value = 122;
    await settleArtwork();
    expect(pendingLeaves).toHaveLength(0);
    expect(findArtworkNode(root, "img")).toBe(image);
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
    expect(findArtworkNode(root, "h1")).toBe(title);
    expect(findArtworkNode(root, "h1")?.text).toBe("Title 122");
    expect(revokedUrls).not.toContain("blob:artwork-1");

    artworkRequest = async () => new Uint8Array([7, 8, 9]).buffer;
    source.value = 123;
    await settleArtwork();
    expect(pendingLeaves).toHaveLength(1);
    expect(revokedUrls).not.toContain("blob:artwork-1");
    for (const finish of pendingLeaves.splice(0)) finish();
    await settleArtwork();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-3");
    expect(findArtworkNode(root, "h1")?.text).toBe("Title 123");
    expect(revokedUrls).toContain("blob:artwork-1");
  });

  for (const [name, component] of [
    ["播放页", presentationArtworkComponent],
    ["TrackInfo", infoArtworkComponent],
  ] as const) {
    it(`${name}同封面切歌复用图片与文字节点`, async () => {
      artworkRequest = async () => new Uint8Array([4, 5, 6]).buffer;
      playingTrack.value = { trackId: 126, title: "Queue 126", artist: "Artist 126" };
      const root = mountArtworkComponent(ref(126), component);
      await settleArtwork();
      const image = findArtworkNode(root, "img");
      const title = findArtworkNode(root, "h1");
      expect(image).not.toBeNull();
      expect(title?.text).toBe("Title 126");

      playingTrack.value = { trackId: 127, title: "Queue 127", artist: "Artist 127" };
      await settleArtwork();
      expect(pendingLeaves).toHaveLength(0);
      expect(findArtworkNode(root, "img")).toBe(image);
      expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
      expect(findArtworkNode(root, "h1")).toBe(title);
      expect(findArtworkNode(root, "h1")?.text).toBe("Title 127");
    });
  }

  it("同曲目刷新后封面内容没变也不重播动画，卸载释放所有图片", async () => {
    artworkRequest = async () => new Uint8Array([4, 5, 6]).buffer;
    const root = mountArtworkComponent(ref(128), transitionArtworkComponent);
    await settleArtwork();
    const image = findArtworkNode(root, "img");

    invalidateTrackArtworkCache([128]);
    await settleArtwork();
    expect(pendingLeaves).toHaveLength(0);
    expect(findArtworkNode(root, "img")).toBe(image);
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
    expect(revokedUrls).toEqual([]);

    mountedApps.pop()?.unmount();
    expect(new Set(revokedUrls)).toEqual(new Set(["blob:artwork-1", "blob:artwork-2"]));
  });

  it("相同占位封面切歌只更新信息，不重复过渡", async () => {
    artworkRequest = async () => new ArrayBuffer(0);
    const source = ref<number | null>(124);
    const root = mountArtworkComponent(source, transitionArtworkComponent);
    await settleArtwork();
    const fallback = findArtworkNode(root, "span");
    expect(fallback).not.toBeNull();

    source.value = 125;
    await settleArtwork();
    expect(pendingLeaves).toHaveLength(0);
    expect(findArtworkNode(root, "span")).toBe(fallback);
    expect(findArtworkNode(root, "h1")?.text).toBe("Title 125");
  });

  it("进入播放页等待尺寸和请求时保留空封面，确认无封面才显示 icon", async () => {
    measuredArtworkSize.value = 0;
    playingTrack.value = { trackId: 119, title: "Title 119", artist: "Artist 119" };
    const request = deferred<TrackArtwork>();
    artworkRequest = () => request.promise;
    const root = mountArtworkComponent(ref(119), presentationArtworkComponent);
    await settleArtwork();
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")).toBeNull();
    expect(findArtworkNode(root, "h1")?.text).toBe("Title 119");
    expect(invokedArtworkRequests).toEqual([]);

    measuredArtworkSize.value = 128;
    await settleArtwork();
    expect(invokedArtworkRequests).toEqual([{ trackId: 119, size: 128 }]);
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")).toBeNull();

    request.resolve(new ArrayBuffer(0));
    await settleArtwork();
    for (const finish of pendingLeaves.splice(0)) finish();
    await settleArtwork();
    expect(findArtworkNode(root, "span")).not.toBeNull();
  });

  it("播放页封面解码期间留空，成功后显示图片", async () => {
    measuredArtworkSize.value = 128;
    playingTrack.value = { trackId: 120, title: "Title 120", artist: "Artist 120" };
    const decoding = deferred<void>();
    decodeImage = () => decoding.promise;
    const root = mountArtworkComponent(ref(120), presentationArtworkComponent);
    await settleArtwork();
    expect(imageInstances).toHaveLength(1);
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")).toBeNull();

    decoding.resolve();
    await settleArtwork();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
    expect(findArtworkNode(root, "span")).toBeNull();
  });

  it("封面先就绪时也保留整份旧展示，直到元数据完成", async () => {
    const request = deferred<TrackDetails | null>();
    detailsRequest = (trackId) =>
      trackId === 111 ? request.promise : Promise.resolve(createDetails(trackId));
    const source = ref<number | null>(110);
    const root = mountArtworkComponent(source, transitionArtworkComponent);
    await settleArtwork();

    source.value = 111;
    await settleArtwork();
    expect(imageInstances).toHaveLength(2);
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
    expect(findArtworkNode(root, "h1")?.text).toBe("Title 110");
    expect(findArtworkNode(root, "p")?.text).toBe("Album 110");
    expect(pendingLeaves).toHaveLength(0);

    request.resolve(createDetails(111));
    await settleArtwork();
    expect(pendingLeaves).toHaveLength(1);
    for (const finish of pendingLeaves.splice(0)) finish();
    await settleArtwork();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-2");
    expect(findArtworkNode(root, "h1")?.text).toBe("Title 111");
    expect(findArtworkNode(root, "p")?.text).toBe("Album 111");
  });

  it("迟到的旧元数据不会覆盖新曲目", async () => {
    const request = deferred<TrackDetails | null>();
    detailsRequest = (trackId) =>
      trackId === 113 ? request.promise : Promise.resolve(createDetails(trackId));
    const source = ref<number | null>(112);
    const root = mountArtworkComponent(source, transitionArtworkComponent);
    await settleArtwork();
    source.value = 113;
    await settleArtwork();
    source.value = 114;
    await settleArtwork();
    request.resolve(createDetails(113));
    await settleArtwork();
    for (const finish of pendingLeaves.splice(0)) finish();
    await settleArtwork();
    expect(findArtworkNode(root, "h1")?.text).toBe("Title 114");
    expect(findArtworkNode(root, "p")?.text).toBe("Album 114");
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-3");
  });

  it("元数据失败时使用当前歌曲摘要，而不是保留上一首的信息", async () => {
    detailsRequest = async (trackId) => {
      if (trackId === 116) throw new Error("database unavailable");
      return createDetails(trackId);
    };
    const source = ref<number | null>(115);
    const root = mountArtworkComponent(source, transitionArtworkComponent);
    await settleArtwork();
    source.value = 116;
    await settleArtwork();
    for (const finish of pendingLeaves.splice(0)) finish();
    await settleArtwork();
    expect(findArtworkNode(root, "h1")?.text).toBe("Queue 116");
    expect(findArtworkNode(root, "p")?.text).toBe("");
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-2");
  });

  it("元数据等待期间卸载会释放新旧图片资源", async () => {
    const request = deferred<TrackDetails | null>();
    detailsRequest = (trackId) =>
      trackId === 118 ? request.promise : Promise.resolve(createDetails(trackId));
    const source = ref<number | null>(117);
    mountArtworkComponent(source, transitionArtworkComponent);
    await settleArtwork();
    source.value = 118;
    await settleArtwork();
    mountedApps.pop()?.unmount();
    expect(new Set(revokedUrls)).toEqual(new Set(["blob:artwork-1", "blob:artwork-2"]));
    request.resolve(createDetails(118));
    await settleArtwork();
    expect(revokedUrls).toHaveLength(2);
  });

  it("首次请求及解码期间不显示默认图", async () => {
    const decoding = deferred<void>();
    decodeImage = () => decoding.promise;
    const root = mountArtworkComponent(ref(101), transitionArtworkComponent);
    await settleArtwork();
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")).toBeNull();

    decoding.resolve();
    await settleArtwork();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
    expect(findArtworkNode(root, "span")).toBeNull();
  });

  it("切歌保留旧图，解码成功后切换，退出动画完成才释放旧 URL", async () => {
    const request = deferred<TrackArtwork>();
    const decoding = deferred<void>();
    artworkRequest = (trackId) =>
      trackId === 103 ? request.promise : Promise.resolve(new Uint8Array([1]).buffer);
    decodeImage = () => (++decodeCount === 2 ? decoding.promise : Promise.resolve());
    const source = ref<number | null>(102);
    const root = mountArtworkComponent(source, transitionArtworkComponent);
    await settleArtwork();

    source.value = 103;
    await settleArtwork();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
    expect(findArtworkNode(root, "h1")?.text).toBe("Title 102");
    expect(findArtworkNode(root, "p")?.text).toBe("Album 102");
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(revokedUrls).toEqual([]);

    request.resolve(new Uint8Array([2]).buffer);
    await settleArtwork();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
    expect(findArtworkNode(root, "span")).toBeNull();

    decoding.resolve();
    await settleArtwork();
    expect(invokedTrackIds).toEqual([102, 103]);
    expect(pendingLeaves).toHaveLength(1);
    expect(revokedUrls).toEqual([]);
    for (const finish of pendingLeaves.splice(0)) finish();
    await settleArtwork();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-2");
    expect(findArtworkNode(root, "h1")?.text).toBe("Title 103");
    expect(findArtworkNode(root, "p")?.text).toBe("Album 103");
    expect(revokedUrls).toEqual(["blob:artwork-1"]);
  });

  it("确认无封面后才从旧封面切换到默认图", async () => {
    const request = deferred<TrackArtwork>();
    artworkRequest = (trackId) =>
      trackId === 105 ? request.promise : Promise.resolve(new Uint8Array([1]).buffer);
    const source = ref<number | null>(104);
    const root = mountArtworkComponent(source, transitionArtworkComponent);
    await settleArtwork();
    source.value = 105;
    await settleArtwork();
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")).not.toBeNull();

    request.resolve(new ArrayBuffer(0));
    await settleArtwork();
    expect(findArtworkNode(root, "span")).not.toBeNull();
    for (const finish of pendingLeaves.splice(0)) finish();
    await settleArtwork();
    expect(findArtworkNode(root, "img")).toBeNull();
    expect(revokedUrls).toEqual(["blob:artwork-1"]);
  });

  it("连续切歌不展示迟到的中间封面，清空曲目后释放旧图", async () => {
    const oldDecode = deferred<void>();
    decodeImage = () => (++decodeCount === 2 ? oldDecode.promise : Promise.resolve());
    const source = ref<number | null>(106);
    const root = mountArtworkComponent(source, transitionArtworkComponent);
    await settleArtwork();
    source.value = 107;
    await settleArtwork();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
    source.value = 108;
    await settleArtwork();
    oldDecode.resolve();
    await settleArtwork();
    for (const finish of pendingLeaves.splice(0)) finish();
    await settleArtwork();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-3");
    expect(findArtworkNode(root, "span")).toBeNull();

    source.value = null;
    await settleArtwork();
    for (const finish of pendingLeaves.splice(0)) finish();
    await settleArtwork();
    expect(findArtworkNode(root, "img")).toBeNull();
    expect(findArtworkNode(root, "span")).not.toBeNull();
    expect(new Set(revokedUrls)).toEqual(
      new Set(["blob:artwork-1", "blob:artwork-2", "blob:artwork-3"]),
    );
  });
});

describe("曲目封面加载", () => {
  it("指定曲目失效不会重新加载其他已订阅封面", async () => {
    const first = mountArtwork(701);
    const second = mountArtwork(702);
    await settleArtwork();
    const secondUrl = second.artwork.url.value;
    invalidateTrackArtworkCache([701]);
    await settleArtwork();
    expect(invokedTrackIds).toEqual([701, 702, 701]);
    expect(first.artwork.url.value).not.toBe("blob:artwork-1");
    expect(second.artwork.url.value).toBe(secondUrl);
  });

  it("两处封面共享请求，并在最后一个订阅者释放时回收资源", async () => {
    const first = mountArtwork(71);
    const second = mountArtwork(71);
    await settleArtwork();

    expect(invokedTrackIds).toEqual([71]);
    expect(first.artwork.status.value).toBe("ready");
    expect(second.artwork.url.value).toBe("blob:artwork-1");

    first.dispose();
    expect(revokedUrls).toEqual([]);
    second.dispose();
    expect(revokedUrls).toEqual(["blob:artwork-1"]);
  });

  it("来源未改变时不重复请求，且请求和解码期间不显示 fallback", async () => {
    const request = deferred<TrackArtwork>();
    const decoding = deferred<void>();
    artworkRequest = () => request.promise;
    decodeImage = () => decoding.promise;
    const source = ref<number | null>(72);
    const { artwork } = mountArtwork(source);
    const root = mountArtworkComponent(source);

    expect(artwork.status.value).toBe("loading");
    expect(artwork.url.value).toBeNull();
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")).toBeNull();
    source.value = 72;
    await nextTick();
    expect(invokedTrackIds).toEqual([72]);

    request.resolve(new Uint8Array([4, 5, 6]).buffer);
    await settleArtwork();
    expect(imageInstances).toHaveLength(1);
    expect(artwork.status.value).toBe("loading");
    expect(artwork.url.value).toBeNull();
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")).toBeNull();

    decoding.resolve();
    await settleArtwork();
    expect(artwork.status.value).toBe("ready");
    expect(artwork.url.value).toBe("blob:artwork-1");
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")?.props.src).toBe("blob:artwork-1");
  });

  it("无封面、请求失败和解码失败时进入 fallback", async () => {
    artworkRequest = async (trackId) => {
      if (trackId === 73) return new ArrayBuffer(0);
      if (trackId === 74) throw new Error("database unavailable");
      return new Uint8Array([7, 8, 9]).buffer;
    };
    decodeImage = async () => {
      throw new Error("image decode failed");
    };

    const noArtwork = mountArtwork(73);
    const noArtworkRoot = mountArtworkComponent(ref(73));
    await settleArtwork();
    expect(noArtwork.artwork.status.value).toBe("fallback");
    expect(findArtworkNode(noArtworkRoot, "span")).not.toBeNull();

    const requestFailure = mountArtwork(74);
    const requestFailureRoot = mountArtworkComponent(ref(74));
    await settleArtwork();
    expect(requestFailure.artwork.status.value).toBe("fallback");
    expect(requestFailure.artwork.error.value).toContain("database unavailable");
    expect(findArtworkNode(requestFailureRoot, "span")).not.toBeNull();

    const decodeFailure = mountArtwork(75);
    const decodeFailureRoot = mountArtworkComponent(ref(75));
    await settleArtwork();
    expect(decodeFailure.artwork.status.value).toBe("fallback");
    expect(decodeFailure.artwork.url.value).toBeNull();
    expect(decodeFailure.artwork.error.value).toContain("image decode failed");
    expect(findArtworkNode(decodeFailureRoot, "span")).not.toBeNull();
  });

  it("迟到的旧请求和旧解码结果不能覆盖新来源", async () => {
    const oldRequest = deferred<TrackArtwork>();
    const oldDecode = deferred<void>();
    artworkRequest = (trackId) =>
      trackId === 76 ? oldRequest.promise : Promise.resolve(new Uint8Array([1]).buffer);
    decodeImage = () => (++decodeCount === 2 ? oldDecode.promise : Promise.resolve());
    const source = ref<number | null>(76);
    const { artwork } = mountArtwork(source);

    source.value = 77;
    await settleArtwork();
    expect(artwork.status.value).toBe("ready");
    expect(artwork.url.value).toBe("blob:artwork-1");

    oldRequest.resolve(new Uint8Array([9]).buffer);
    await settleArtwork();
    expect(invokedTrackIds).toEqual([76, 77]);
    expect(artwork.url.value).toBe("blob:artwork-1");

    const decodingSource = ref<number | null>(78);
    const oldDecoderArtwork = mountArtwork(decodingSource);
    await settleArtwork();
    expect(oldDecoderArtwork.artwork.status.value).toBe("loading");

    decodingSource.value = 79;
    await settleArtwork();
    const currentUrl = oldDecoderArtwork.artwork.url.value;
    expect(currentUrl).toBe("blob:artwork-3");

    oldDecode.resolve();
    await settleArtwork();
    expect(oldDecoderArtwork.artwork.status.value).toBe("ready");
    expect(oldDecoderArtwork.artwork.url.value).toBe(currentUrl);
  });
});

describe("大队列封面调度", () => {
  it("40 条缩略图订阅最多启动两项，当前曲目原图无需等待它们", async () => {
    const pending = deferred<TrackArtwork>();
    artworkRequest = (trackId) =>
      trackId === 900 ? Promise.resolve(new Uint8Array([9]).buffer) : pending.promise;
    for (let trackId = 800; trackId < 840; trackId++) {
      const scope = effectScope();
      mountedScopes.push(scope);
      scope.run(() => useTrackArtwork(trackId, 80));
    }
    expect(invokedTrackIds).toEqual([800, 801]);
    const current = mountArtwork(900);
    expect(invokedTrackIds).toEqual([800, 801, 900]);
    expect(invokedArtworkRequests).toEqual([
      { trackId: 800, size: 80 },
      { trackId: 801, size: 80 },
      { trackId: 900, size: null },
    ]);
    await settleArtwork();
    expect(current.artwork.status.value).toBe("ready");
    current.dispose();
    for (const scope of mountedScopes.splice(0)) scope.stop();
    pending.resolve(new ArrayBuffer(0));
    await settleArtwork();
    expect(invokedTrackIds).toEqual([800, 801, 900]);
  });
});

it("同曲目缩略图与原图分别共享，失效时两种用途都刷新并保留二进制内容", async () => {
  artworkRequest = async () => new Uint8Array([1, 2, 3]).buffer;
  mountArtwork(950);
  const scope = effectScope();
  mountedScopes.push(scope);
  scope.run(() => {
    useTrackArtwork(950, 80);
    useTrackArtwork(950, 80);
  });
  await settleArtwork();
  expect(invokedArtworkRequests).toEqual([
    { trackId: 950, size: null },
    { trackId: 950, size: 80 },
  ]);
  expect(new Uint8Array(await imageBlobs[0]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  invalidateTrackArtworkCache([950]);
  await settleArtwork();
  expect(invokedArtworkRequests).toHaveLength(4);
  expect(new Set(revokedUrls)).toEqual(new Set(["blob:artwork-1", "blob:artwork-2"]));
});

it("实际尺寸就绪后才请求，尺寸变化不复用旧 URL，更新只刷新仍订阅的尺寸", async () => {
  const size = ref(0);
  const scope = effectScope();
  mountedScopes.push(scope);
  const artwork = scope.run(() => useTrackArtwork(701, size));
  expect(invokedArtworkRequests).toEqual([]);
  expect(artwork?.status.value).toBe("loading");
  size.value = 40;
  await settleArtwork();
  expect(invokedArtworkRequests).toEqual([{ trackId: 701, size: 40 }]);
  const oldUrl = artwork?.url.value;
  size.value = 120;
  await settleArtwork();
  expect(invokedArtworkRequests[invokedArtworkRequests.length - 1]).toEqual({
    trackId: 701,
    size: 120,
  });
  expect(artwork?.url.value).not.toBe(oldUrl);
  invalidateTrackArtworkCache([701]);
  await settleArtwork();
  expect(invokedArtworkRequests.map((request) => request.size)).toEqual([40, 120, 120]);
});

it("保留当前尺寸封面不新增加载订阅或额外请求原图", async () => {
  const scope = effectScope();
  mountedScopes.push(scope);
  const artwork = scope.run(() => useTrackArtwork(702, 128));
  await settleArtwork();
  const url = artwork?.url.value;
  if (!url) throw new Error("Missing thumbnail URL");
  if (!artwork) throw new Error("Missing thumbnail subscription");
  const release = artwork.retain();
  scope.stop();
  expect(invokedArtworkRequests).toEqual([{ trackId: 702, size: 128 }]);
  expect(revokedUrls).not.toContain(url);
  release();
  expect(revokedUrls).toContain(url);
});

it("同曲目和尺寸的元数据对象更新不重读封面", async () => {
  const track = ref({ id: 703, title: "old" });
  const scope = effectScope();
  mountedScopes.push(scope);
  scope.run(() => useTrackArtwork(() => track.value.id, 96));
  await settleArtwork();
  track.value = { id: 703, title: "new" };
  await settleArtwork();
  expect(invokedArtworkRequests).toEqual([{ trackId: 703, size: 96 }]);
});

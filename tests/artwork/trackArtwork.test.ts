import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { effectScope, nextTick, ref } from "vue";
import type { Ref } from "vue";
import { compileSfc, evaluateModule, loadSourceModules } from "../support/moduleLoader";
import { notify } from "@/notification/center";
import { useNotification } from "@/notification/useNotification";
import { createHostNode, createHostRenderer } from "../support/hostRenderer";
import type { HostNode as ArtworkHostNode } from "../support/hostRenderer";
import type { TrackArtwork } from "@/artwork/types";
import type { TrackDetails } from "@/library/model";

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

let artworkRequest: (trackId: number) => Promise<TrackArtwork | null>;
let detailsRequest: (trackId: number) => Promise<TrackDetails | null>;
let decodeImage: (image: TestImage) => Promise<void>;
let invokedTrackIds: number[];
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
  "@/notification/center": { notify },
  "@/notification/useNotification": { useNotification },
};
dependencies["@tauri-apps/api/core"] = {
  invoke: (command: string, args?: { trackId: number }) => {
    if (!args) throw new Error("Track request is missing its track ID.");
    if (command === "get_track") return detailsRequest(args.trackId);
    invokedTrackIds.push(args.trackId);
    return artworkRequest(args.trackId);
  },
};

await loadSourceModules(["artwork/trackArtwork.ts", "playback/useTrackInfo.ts"], dependencies);
const artworkModule = dependencies[
  "@/artwork/trackArtwork"
] as typeof import("@/artwork/trackArtwork");
const trackInfoModule = dependencies[
  "@/playback/useTrackInfo"
] as typeof import("@/playback/useTrackInfo");
const { useTrackArtwork, invalidateTrackArtworkCache, retainTrackArtwork } = artworkModule;

function createTrackArtworkComponent(source: string, filename = "src/artwork/ui/TrackArtwork.vue") {
  const output = compileSfc(source, filename, { id: "track-artwork-test" });
  const modules: Record<string, unknown> = {
    vue: { ...Vue, Transition: testTransition },
    "@/artwork/trackArtwork": artworkModule,
    "@/playback/useTrackInfo": trackInfoModule,
  };
  return evaluateModule<{ default: Vue.Component }>(output, modules).default;
}

const trackArtworkComponent = createTrackArtworkComponent(
  await Bun.file(new URL("../../src/artwork/ui/TrackArtwork.vue", import.meta.url)).text(),
);

const transitionArtworkComponent = createTrackArtworkComponent(
  await Bun.file(new URL("../../src/playback/ui/TransitionNowPlaying.vue", import.meta.url)).text(),
  "src/playback/ui/TransitionNowPlaying.vue",
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
                detailsError: string;
              }) => [
                Vue.h("h1", snapshot.details?.title ?? snapshot.track?.title ?? ""),
                Vue.h("p", snapshot.details?.album ?? ""),
                Vue.h("div", { "data-test": "details-error" }, snapshot.detailsError),
                snapshot.artworkUrl
                  ? Vue.h("img", { src: snapshot.artworkUrl })
                  : Vue.h("span", { "data-test": "fallback" }, "fallback"),
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
  invokedTrackIds = [];
  revokedUrls = [];
  nextObjectUrl = 0;
  decodeCount = 0;
  imageInstances = [];
  artworkRequest = async () => ({ status: "available", mimeType: "image/png", data: [1, 2, 3] });
  detailsRequest = async (trackId) => createDetails(trackId);
  decodeImage = async () => {};
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => `blob:artwork-${++nextObjectUrl}`,
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
    const request = deferred<TrackArtwork | null>();
    const decoding = deferred<void>();
    artworkRequest = (trackId) =>
      trackId === 103
        ? request.promise
        : Promise.resolve({ status: "available", mimeType: "image/png", data: [1] });
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

    request.resolve({ status: "available", mimeType: "image/png", data: [2] });
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
    const request = deferred<TrackArtwork | null>();
    artworkRequest = (trackId) =>
      trackId === 105
        ? request.promise
        : Promise.resolve({ status: "available", mimeType: "image/png", data: [1] });
    const source = ref<number | null>(104);
    const root = mountArtworkComponent(source, transitionArtworkComponent);
    await settleArtwork();
    source.value = 105;
    await settleArtwork();
    expect(findArtworkNode(root, "span")).toBeNull();
    expect(findArtworkNode(root, "img")).not.toBeNull();

    request.resolve({ status: "noArtwork" });
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

  it("缓存刷新时仍保留正在退出的 URL，最后一次释放才回收", async () => {
    const { artwork } = mountArtwork(109);
    await settleArtwork();
    const releaseFirst = retainTrackArtwork(109);
    const releaseSecond = retainTrackArtwork(109);

    invalidateTrackArtworkCache();
    await settleArtwork();
    expect(artwork.url.value).toBe("blob:artwork-2");
    expect(revokedUrls).toEqual([]);
    releaseFirst();
    releaseFirst();
    expect(revokedUrls).toEqual([]);
    releaseSecond();
    expect(revokedUrls).toEqual(["blob:artwork-1"]);
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
    const request = deferred<TrackArtwork | null>();
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

    request.resolve({ status: "available", mimeType: "image/png", data: [4, 5, 6] });
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
      if (trackId === 73) return null;
      if (trackId === 74) throw new Error("database unavailable");
      return { status: "available", mimeType: "image/png", data: [7, 8, 9] };
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
    const oldRequest = deferred<TrackArtwork | null>();
    const oldDecode = deferred<void>();
    artworkRequest = (trackId) =>
      trackId === 76
        ? oldRequest.promise
        : Promise.resolve({
            status: "available",
            mimeType: "image/png",
            data: [1],
          });
    decodeImage = () => (++decodeCount === 2 ? oldDecode.promise : Promise.resolve());
    const source = ref<number | null>(76);
    const { artwork } = mountArtwork(source);

    source.value = 77;
    await settleArtwork();
    expect(artwork.status.value).toBe("ready");
    expect(artwork.url.value).toBe("blob:artwork-1");

    oldRequest.resolve({ status: "available", mimeType: "image/png", data: [9] });
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

import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource, loadSourceModules } from "../../support/module/loader";
import { createHostNode, createHostRenderer, findNode } from "../../support/host/renderer";
import type { HostNode } from "../../support/host/renderer";
import type { TrackPresentation } from "@/features/tracks/types";

const originals = (
  [
    [globalThis, "IntersectionObserver"],
    [globalThis, "Image"],
    [globalThis, "window"],
    [URL, "createObjectURL"],
    [URL, "revokeObjectURL"],
  ] as const
).map(([target, key]) => ({
  target,
  key,
  descriptor: Object.getOwnPropertyDescriptor(target, key),
}));
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const { target, key, descriptor } of originals) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});

function imageUrl(root: HostNode): string {
  const url = findNode(root, (node) => node.type === "img")?.props.src;
  if (typeof url !== "string") throw new Error("Queue artwork URL is missing");
  return url;
}

async function settleArtwork() {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
    await Vue.nextTick();
  }
}

async function createQueueArtworkFixture(
  decode: () => Promise<void> = async () => {},
  load: () => Promise<ArrayBuffer> = async () => new Uint8Array([1, 2, 3]).buffer,
  presentation: () => Promise<TrackPresentation> = async () => ({
    title: "Confirmed title",
    album: "Confirmed album",
    durationMs: 125000,
  }),
) {
  const observers: TestObserver[] = [];
  class TestObserver {
    disconnected = false;
    constructor(private callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
    show(visible: boolean) {
      this.callback([{ isIntersecting: visible }]);
    }
  }
  let decodeCount = 0;
  class TestImage {
    src = "";
    decode() {
      decodeCount++;
      return decode();
    }
    removeAttribute(name: string) {
      if (name === "src") this.src = "";
    }
  }
  const revokedUrls: string[] = [];
  let nextUrl = 0;
  for (const [target, key, value] of [
    [globalThis, "IntersectionObserver", TestObserver],
    [globalThis, "Image", TestImage],
    [URL, "createObjectURL", () => `blob:queue-artwork-${++nextUrl}`],
    [URL, "revokeObjectURL", (url: string) => revokedUrls.push(url)],
  ] as const) {
    Object.defineProperty(target, key, { configurable: true, value });
  }
  const requests: Array<{ trackId: number; size: number | null }> = [];
  let metadataPending = false;
  const icon = Vue.defineComponent({ render: () => null });
  const fallback = Vue.defineComponent({
    render: () => Vue.h("span", { "data-test": "artwork-fallback" }),
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const dependencies: Record<string, unknown> = {
    vue: Vue,
    "@/features/tracks/events": { TRACKS_CHANGED_EVENT: "newbee:tracks-changed" },
    "@lucide/vue": { AudioLines: icon, Disc3: fallback, SkipForward: icon },
    "@tauri-apps/api/core": {
      invoke: async (command: string, args: { trackId: number; size: number | null }) => {
        if (command === "is_track_metadata_pending") return metadataPending;
        if (command === "get_track_presentation") return metadataPending ? null : presentation();
        requests.push(args);
        return load();
      },
    },
  };
  await loadSourceModules(["features/artwork/useTrackArtwork.ts"], dependencies);
  const artworkModule = dependencies[
    "@/features/artwork/useTrackArtwork"
  ] as typeof import("@/features/artwork/useTrackArtwork");
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(
      await Bun.file("src/features/playback/queue/components/QueueRow.vue").text(),
      "QueueRow.vue",
    ),
    dependencies,
  ).default;
  return {
    component,
    observers,
    requests,
    revokedUrls,
    decodeCount: () => decodeCount,
    invalidate: artworkModule.invalidateTrackArtworkCache,
    setMetadataPending: (pending: boolean) => {
      metadataPending = pending;
    },
  };
}

it("40 行队列首次可见才加载，滚动保留图片，移除和卸载释放资源", async () => {
  const fixture = await createQueueArtworkFixture();
  const trackId = Vue.ref(100);
  const showFirst = Vue.ref(true);
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(
        "ul",
        Array.from({ length: 40 }, (_, index) => index)
          .filter((index) => index !== 0 || showFirst.value)
          .map((index) =>
            Vue.h(fixture.component, {
              key: index,
              trackId: index === 0 ? trackId.value : index + 100,
              rowKey: String(index),
              title: "Track",
              album: "Album",
              duration: "1:00",
              isFocused: false,
            }),
          ),
      ),
  });
  apps.push(app);
  app.mount(root);
  expect(fixture.requests).toEqual([]);
  expect(fixture.observers).toHaveLength(40);
  fixture.observers[0]!.show(true);
  await settleArtwork();
  const firstImage = findNode(root, (node) => node.type === "img");
  expect(firstImage).not.toBeNull();
  const firstUrl = imageUrl(root);
  expect(fixture.requests).toEqual([{ trackId: 100, size: 128 }]);
  for (let index = 0; index < 3; index++) {
    fixture.observers[0]!.show(false);
    await settleArtwork();
    expect(findNode(root, (node) => node.type === "img") === firstImage).toBe(true);
    fixture.observers[0]!.show(true);
    await settleArtwork();
    expect(findNode(root, (node) => node.type === "img") === firstImage).toBe(true);
    expect(firstImage!.props.src).toBe(firstUrl);
  }
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.decodeCount()).toBe(1);
  expect(fixture.revokedUrls).toEqual([]);

  fixture.observers[0]!.show(false);
  trackId.value = 200;
  await settleArtwork();
  expect(fixture.requests[1]).toEqual({ trackId: 200, size: 128 });
  expect(fixture.revokedUrls).toEqual([firstUrl]);
  const changedUrl = imageUrl(root);
  fixture.invalidate([200]);
  await settleArtwork();
  expect(fixture.requests[2]).toEqual({ trackId: 200, size: 128 });
  expect(fixture.revokedUrls).toEqual([firstUrl, changedUrl]);
  const refreshedUrl = imageUrl(root);

  showFirst.value = false;
  await settleArtwork();
  expect(fixture.revokedUrls).toEqual([firstUrl, changedUrl, refreshedUrl]);
  expect(fixture.observers[0]!.disconnected).toBe(true);
  fixture.observers[1]!.show(true);
  await settleArtwork();
  expect(fixture.requests[3]).toEqual({ trackId: 101, size: 128 });
  const secondUrl = imageUrl(root);
  app.unmount();
  expect(fixture.revokedUrls).toEqual([firstUrl, changedUrl, refreshedUrl, secondUrl]);
  expect(fixture.observers.every((observer) => observer.disconnected)).toBe(true);
});

it("解码期间快速滚出再滚入不重新请求，解码完成后显示同一封面", async () => {
  let finishDecode!: () => void;
  const decoding = new Promise<void>((resolve) => {
    finishDecode = resolve;
  });
  const fixture = await createQueueArtworkFixture(() => decoding);
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(fixture.component, {
        trackId: 100,
        rowKey: "100",
        title: "Track",
        album: "Album",
        duration: "1:00",
        isFocused: false,
      }),
  });
  apps.push(app);
  app.mount(root);
  fixture.observers[0]!.show(true);
  await settleArtwork();
  expect(fixture.decodeCount()).toBe(1);
  fixture.observers[0]!.show(false);
  await settleArtwork();
  fixture.observers[0]!.show(true);
  await settleArtwork();
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.decodeCount()).toBe(1);
  expect(fixture.revokedUrls).toEqual([]);
  finishDecode();
  await settleArtwork();
  expect(findNode(root, (node) => node.type === "img")?.props.src).toBe("blob:queue-artwork-1");
});

it.each(["cover", "missing", "request-failure", "decode-failure"])(
  "未登记曲目等待确认时保持透明，确认后处理 %s",
  async (outcome) => {
    let finishDecode!: () => void;
    const decoding = new Promise<void>((resolve) => {
      finishDecode = resolve;
    });
    const fixture = await createQueueArtworkFixture(
      () => (outcome === "decode-failure" ? Promise.reject(new Error("Decode failed")) : decoding),
      async () => {
        if (outcome === "request-failure") throw new Error("Read failed");
        return new Uint8Array(outcome === "missing" ? [] : [1, 2, 3]).buffer;
      },
    );
    fixture.setMetadataPending(true);
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp({
      setup: () => () =>
        Vue.h(fixture.component, {
          trackId: 100,
          rowKey: "100",
          title: "Track",
          album: "Album",
          duration: "1:00",
          isFocused: false,
        }),
    });
    apps.push(app);
    app.mount(root);
    const findFallback = () =>
      findNode(root, (node) => node.props["data-test"] === "artwork-fallback");
    expect(findFallback()).toBeNull();
    expect(
      findNode(root, (node) => node.props.class === "truncate text-sm font-medium text-white")
        ?.text,
    ).toBe("");
    expect(
      findNode(root, (node) => node.props.class === "text-app-muted truncate text-xs")?.text,
    ).toBe("");
    expect(
      findNode(
        root,
        (node) => node.props.class === "text-app-muted shrink-0 pl-1 text-xs tabular-nums",
      )?.text,
    ).toBe("");
    fixture.observers[0]!.show(true);
    await settleArtwork();
    expect(fixture.requests).toEqual([]);
    expect(findFallback()).toBeNull();
    expect(findNode(root, (node) => node.type === "img")).toBeNull();

    fixture.setMetadataPending(false);
    globalThis.window.dispatchEvent(
      new CustomEvent("newbee:tracks-changed", { detail: { trackIds: [100] } }),
    );
    fixture.invalidate([100]);
    await settleArtwork();
    expect(fixture.requests).toEqual([{ trackId: 100, size: 128 }]);
    expect(
      findNode(root, (node) => node.props.class === "truncate text-sm font-medium text-white")
        ?.text,
    ).toBe("Confirmed title");
    expect(
      findNode(root, (node) => node.props.class === "text-app-muted truncate text-xs")?.text,
    ).toBe("Confirmed album");
    expect(
      findNode(
        root,
        (node) => node.props.class === "text-app-muted shrink-0 pl-1 text-xs tabular-nums",
      )?.text,
    ).toBe("2:05");
    if (outcome === "cover") {
      expect(findFallback()).toBeNull();
      expect(findNode(root, (node) => node.type === "img")).toBeNull();
      finishDecode();
      await settleArtwork();
      expect(imageUrl(root)).toBe("blob:queue-artwork-1");
      expect(findFallback()).toBeNull();
    } else {
      expect(findFallback()).not.toBeNull();
      expect(findNode(root, (node) => node.type === "img")).toBeNull();
    }
  },
);

it.each(["missing", "failed"])("队列元数据 %s 后才显示缺失值回退", async (outcome) => {
  const fixture = await createQueueArtworkFixture(
    async () => {},
    async () => new ArrayBuffer(0),
    async () => {
      if (outcome === "failed") throw new Error("Metadata read failed");
      return { title: "filename", album: null, durationMs: null };
    },
  );
  fixture.setMetadataPending(true);
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(fixture.component, {
        trackId: 100,
        rowKey: "100",
        title: "filename",
        album: "未知专辑",
        duration: "时长未知",
        isFocused: false,
      }),
  });
  apps.push(app);
  app.mount(root);
  const fields = () => ({
    title: findNode(root, (node) => node.props.class === "truncate text-sm font-medium text-white")
      ?.text,
    album: findNode(root, (node) => node.props.class === "text-app-muted truncate text-xs")?.text,
    duration: findNode(
      root,
      (node) => node.props.class === "text-app-muted shrink-0 pl-1 text-xs tabular-nums",
    )?.text,
  });
  expect(fields()).toEqual({ title: "", album: "", duration: "" });
  await settleArtwork();
  expect(fields()).toEqual({ title: "", album: "", duration: "" });
  fixture.setMetadataPending(false);
  globalThis.window.dispatchEvent(
    new CustomEvent("newbee:tracks-changed", { detail: { trackIds: [100] } }),
  );
  await settleArtwork();
  expect(fields()).toEqual({ title: "filename", album: "未知专辑", duration: "时长未知" });
});

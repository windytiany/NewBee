import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource, loadSourceModules } from "../../support/moduleLoader";
import { createHostNode, createHostRenderer, findNode } from "../../support/hostRenderer";
import type { HostNode } from "../../support/hostRenderer";

const originals = (
  [
    [globalThis, "IntersectionObserver"],
    [globalThis, "Image"],
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

async function createQueueArtworkFixture(decode: () => Promise<void> = async () => {}) {
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
  const icon = Vue.defineComponent({ render: () => null });
  const dependencies: Record<string, unknown> = {
    vue: Vue,
    "@lucide/vue": { AudioLines: icon, Disc3: icon, SkipForward: icon },
    "@tauri-apps/api/core": {
      invoke: async (_command: string, args: { trackId: number; size: number | null }) => {
        requests.push(args);
        return new Uint8Array([1, 2, 3]).buffer;
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
  expect(fixture.requests).toEqual([{ trackId: 100, size: 40 }]);
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
  expect(fixture.requests[1]).toEqual({ trackId: 200, size: 40 });
  expect(fixture.revokedUrls).toEqual([firstUrl]);
  const changedUrl = imageUrl(root);
  fixture.invalidate([200]);
  await settleArtwork();
  expect(fixture.requests[2]).toEqual({ trackId: 200, size: 40 });
  expect(fixture.revokedUrls).toEqual([firstUrl, changedUrl]);
  const refreshedUrl = imageUrl(root);

  showFirst.value = false;
  await settleArtwork();
  expect(fixture.revokedUrls).toEqual([firstUrl, changedUrl, refreshedUrl]);
  expect(fixture.observers[0]!.disconnected).toBe(true);
  fixture.observers[1]!.show(true);
  await settleArtwork();
  expect(fixture.requests[3]).toEqual({ trackId: 101, size: 40 });
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

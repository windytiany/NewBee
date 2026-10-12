import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import { createHostNode, createHostRenderer } from "../../../support/host/renderer";

const source = await Bun.file("src/features/artwork/artist/ArtistPhoto.vue").text();
const original = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
const apps: Vue.App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (original) Object.defineProperty(globalThis, "IntersectionObserver", original);
  else Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

it("only visible artist photos activate local reads and automatic lookup", async () => {
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
    show(isIntersecting: boolean) {
      this.callback([{ isIntersecting }]);
    }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: TestObserver,
  });
  const reads: string[] = [];
  const searches: string[] = [];
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "ArtistPhoto.vue"),
    {
      vue: Vue,
      "@lucide/vue": { UserRound: Vue.defineComponent(() => () => null) },
      "@/features/artwork/artist/api": {
        readArtistPhoto: async (artist: string) => {
          reads.push(artist);
          return new ArrayBuffer(0);
        },
        findArtistPhoto: async (artist: string) => {
          searches.push(artist);
          return false;
        },
      },
      "@/shared/notifications/center": { notify: () => {} },
    },
  ).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(
        "div",
        ["A", "B", null].map((artist) => Vue.h(component, { artist })),
      ),
  });
  apps.push(app);
  app.mount(root);
  expect(observers).toHaveLength(3);
  expect(reads).toEqual([]);
  observers[0]!.show(false);
  await Vue.nextTick();
  expect(reads).toEqual([]);
  observers[0]!.show(true);
  await settle();
  expect(reads).toEqual(["A"]);
  expect(searches).toEqual(["A"]);
  expect(observers[0]!.disconnected).toBe(true);
  observers[0]!.show(true);
  observers[2]!.show(true);
  await settle();
  expect(searches).toEqual(["A"]);
  app.unmount();
  expect(observers.every((observer) => observer.disconnected)).toBe(true);
});

async function settle() {
  for (let index = 0; index < 8; index++) {
    await Vue.nextTick();
    await Promise.resolve();
  }
}

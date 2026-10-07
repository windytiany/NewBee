import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";
import { createHostNode, createHostRenderer } from "../../support/hostRenderer";

const originalObserver = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (originalObserver) Object.defineProperty(globalThis, "IntersectionObserver", originalObserver);
  else Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

it("40 行队列仅为可见行获取逐曲目缩略图，离开视口和卸载会停止订阅", async () => {
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
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: TestObserver,
  });
  const requests: Array<{ trackId: number; thumbnail: boolean }> = [];
  const icon = Vue.defineComponent({ render: () => null });
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(
      await Bun.file("src/features/playback/queue/components/QueueRow.vue").text(),
      "QueueRow.vue",
    ),
    {
      vue: Vue,
      "@lucide/vue": { AudioLines: icon, Disc3: icon, SkipForward: icon },
      "@tauri-apps/api/core": {
        invoke: async (_command: string, args: { trackId: number; thumbnail: boolean }) => {
          requests.push(args);
          return new ArrayBuffer(0);
        },
      },
    },
  ).default;
  const trackId = Vue.ref(100);
  const app = createHostRenderer(createHostNode).createApp({
    setup: () => () =>
      Vue.h(
        "ul",
        Array.from({ length: 40 }, (_, index) =>
          Vue.h(component, {
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
  app.mount(createHostNode("root"));
  expect(requests).toEqual([]);
  expect(observers).toHaveLength(40);
  observers[0]!.show(true);
  await Vue.nextTick();
  expect(requests).toEqual([{ trackId: 100, thumbnail: true }]);
  observers[0]!.show(false);
  await Vue.nextTick();
  trackId.value = 200;
  await Vue.nextTick();
  expect(requests).toHaveLength(1);
  observers[0]!.show(true);
  await Vue.nextTick();
  expect(requests[1]).toEqual({ trackId: 200, thumbnail: true });
  app.unmount();
  expect(observers.every((observer) => observer.disconnected)).toBe(true);
});

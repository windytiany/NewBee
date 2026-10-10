import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { playbackFixture, playbackSnapshot } from "../../support/playbackSession";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";

import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/hostRenderer";

const source = await Bun.file("src/features/playback/queue/components/SkipMenuItem.vue").text();
const rowSource = await Bun.file("src/features/playback/queue/components/QueueRow.vue").text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});

async function settle() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  await Vue.nextTick();
}

async function menu(trackIds: number[], initialSkipped: number[] = [], fail = false) {
  const writes: Array<{ trackIds: number[]; skipped: boolean }> = [];
  const errors: string[] = [];
  let closes = 0;
  const fixture = playbackFixture({
    initialSnapshot: playbackSnapshot({ skippedTrackIds: initialSkipped }),
    invokeExtra: (command, args) => {
      if (command !== "set_tracks_skipped") throw new Error(`Unexpected command: ${command}`);
      if (fail) throw new Error("database unavailable");
      writes.push(args as { trackIds: number[]; skipped: boolean });
    },
  });
  await fixture.session.ready;
  const preferences = fixture.session.state;
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "src/features/playback/queue/components/SkipMenuItem.vue"),
    {
      vue: Vue,
      "@/features/playback/session": {
        usePlaybackSession: () => fixture.session,
      },
      "@/shared/notifications/center": {
        notify: ({ message }: { message: string }) => errors.push(message),
      },
    },
  ).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(component, {
    trackIds,
    onClose: () => {
      closes += 1;
    },
  });
  app.mount(root);
  apps.push(app);
  await settle();
  const button = findNode(root, (node) => node.type === "button")!;
  return {
    preferences,
    button,
    writes,
    errors,
    get closes() {
      return closes;
    },
  };
}

it("marks every selected global track, including a mixed selection with duplicate occurrences", async () => {
  const h = await menu([1, 2, 2], [1]);
  expect(getTextContent(h.button)).toBe("跳过");
  await (h.button.props.onClick as (event: { stopPropagation: () => void }) => Promise<void>)({
    stopPropagation: () => {},
  });
  await settle();
  expect(h.writes).toEqual([{ trackIds: [1, 2], skipped: true }]);
  expect(h.preferences.skippedTrackIds.value).toEqual([1, 2]);
  expect(h.closes).toBe(1);
  expect(getTextContent(h.button)).toBe("取消跳过");
});

it("cancels skip for every selected flagged track", async () => {
  const h = await menu([1, 2], [1, 2]);
  expect(getTextContent(h.button)).toBe("取消跳过");
  await (h.button.props.onClick as (event: { stopPropagation: () => void }) => Promise<void>)({
    stopPropagation: () => {},
  });
  expect(h.writes).toEqual([{ trackIds: [1, 2], skipped: false }]);
  expect(h.preferences.skippedTrackIds.value).toEqual([]);
});

it("reports failed persistence without changing the visible preference", async () => {
  const h = await menu([1], [1], true);
  await (h.button.props.onClick as (event: { stopPropagation: () => void }) => Promise<void>)({
    stopPropagation: () => {},
  });
  expect(h.errors).toEqual(["更新跳过标记失败"]);
  expect(h.preferences.skippedTrackIds.value).toContain(1);
});

it("shows the skip icon while keeping queue double-click playback available", async () => {
  let plays = 0;
  const icon = Vue.defineComponent({ render: () => Vue.h("svg") });
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(rowSource, "src/features/playback/queue/components/QueueRow.vue"),
    {
      vue: Vue,
      "@tauri-apps/api/core": { invoke: async () => null },
      "@lucide/vue": { AudioLines: icon, Disc3: icon, SkipForward: icon },
    },
  ).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(component, {
    trackId: 1,
    rowKey: "duplicate",
    title: "Track",
    album: "Album",
    duration: "1:00",
    isFocused: false,
    isSkipped: true,
    onPlay: () => {
      plays += 1;
    },
  });
  app.mount(root);
  apps.push(app);
  expect(
    findNode(root, (node) => node.props["aria-label"] === "自动播放时跳过，双击仍可播放"),
  ).not.toBeNull();
  const button = findNode(root, (node) => node.type === "button")!;
  (button.props.onDblclick as (event: { button: number }) => void)({ button: 0 });
  expect(plays).toBe(1);
});

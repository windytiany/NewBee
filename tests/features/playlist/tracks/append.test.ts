import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";
import type { HostNode } from "../../../support/host/renderer";
import type { PlaylistAppendResult } from "@/features/playlist/types";

const apps: Vue.App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
const source = await Bun.file("src/features/playlist/tracks/AppendMenuItem.vue").text();
function node(type: string, text = "") {
  return {
    ...createHostNode(type, text),
    getBoundingClientRect: () => ({ left: 0, right: 200, top: 0, width: 200, height: 100 }),
    focus() {},
  };
}
function button(root: HostNode, label: string) {
  const found = findNode(
    root,
    (entry) => entry.type === "button" && getTextContent(entry).trim() === label,
  );
  if (!found || typeof found.props.onClick !== "function")
    throw new Error(`Missing action ${label}`);
  return found.props.onClick;
}
async function mount(results: PlaylistAppendResult[] | Error) {
  const appended: Array<{ playlistId: number; ids: number[] }> = [];
  const changed: number[] = [];
  const created: number[][] = [];
  const messages: unknown[] = [];
  const events: string[] = [];
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "AppendMenuItem.vue"),
    {
      vue: Vue,
      "@lucide/vue": { ChevronRight: Vue.defineComponent(() => () => null) },
      "@/features/playlist/api": {
        createPlaylistApi: () => ({
          list: async () => [{ id: 7, name: "Current", trackCount: 2, coverTrackId: 1 }],
          appendTracks: async (playlistId: number, ids: number[]) => {
            appended.push({ playlistId, ids });
            if (results instanceof Error) throw results;
            return results;
          },
        }),
      },
      "@/features/playlist/events": { reportPlaylistChanged: (id: number) => changed.push(id) },
      "@/shared/notifications/center": { notify: (message: unknown) => messages.push(message) },
    },
  ).default;
  const root = node("root");
  const app = createHostRenderer<HostNode>(node).createApp(component, {
    trackIds: [1, 1, 2],
    onClose: () => events.push("close"),
    onCreate: (ids: number[]) => {
      events.push("create");
      created.push(ids);
    },
  });
  app.mount(root);
  apps.push(app);
  await button(root, "添加到播放列表")({ stopPropagation() {} });
  await Vue.nextTick();
  return { root, appended, changed, created, messages, events };
}
it("keeps duplicates when appending to the current playlist and reports partial success", async () => {
  const context = await mount([
    { index: 0, trackId: 1, status: "added", playlistItemId: 11 },
    { index: 1, trackId: 1, status: "added", playlistItemId: 12 },
    { index: 2, trackId: 2, status: "failed", error: "missing target" },
  ]);
  await button(context.root, "Current")({ stopPropagation() {} });
  expect(context.appended).toEqual([{ playlistId: 7, ids: [1, 1, 2] }]);
  expect(context.changed).toEqual([7]);
  expect(context.messages).toHaveLength(1);
  expect(context.events).toEqual(["close"]);
});
it("closes before opening creation and preserves the selected tracks", async () => {
  const context = await mount([]);
  await button(context.root, "新建播放列表…")({ stopPropagation() {} });
  expect(context.events).toEqual(["close", "create"]);
  expect(context.created).toEqual([[1, 1, 2]]);
  expect(context.appended).toEqual([]);
});
it("reports an append rejection without claiming that the playlist changed", async () => {
  const context = await mount(new Error("database unavailable"));
  await button(context.root, "Current")({ stopPropagation() {} });
  expect(context.changed).toEqual([]);
  expect(context.messages).toHaveLength(1);
});

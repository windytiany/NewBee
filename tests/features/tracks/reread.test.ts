import { expect, it } from "bun:test";
import * as Vue from "vue";
import type { useTrackReread } from "@/features/tracks/reread";
import type { TrackReadResult } from "@/features/tracks/types";
import type { NotificationInput } from "@/shared/notifications/center";
import { compileSfc, evaluateSource, transpileScript } from "../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/host/renderer";

const output = transpileScript(await Bun.file("src/features/tracks/reread.ts").text());
const menuOutput = compileSfc(
  await Bun.file("src/features/tracks/presentation/RereadMenuItem.vue").text(),
  "src/features/tracks/presentation/RereadMenuItem.vue",
);
function action(results: TrackReadResult[], refreshError = false, readError = false) {
  const commands: Array<[string, unknown]> = [];
  const notices: NotificationInput[] = [];
  const logs: unknown[][] = [];
  const module = evaluateSource<{ useTrackReread: typeof useTrackReread }>(output, {
    vue: Vue,
    "@tauri-apps/api/core": {
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        commands.push([command, args]);
        if (command === "reread_track_tags") {
          if (readError) throw new Error("read unavailable");
          return results as T;
        }
        expect(command).toBe("get_tracks");
        if (refreshError) throw new Error("refresh unavailable");
        return [] as T;
      },
    },
    "@/features/playback/session": {
      usePlaybackSession: () => ({
        updateTrackMetadata: async (tracks: unknown) => {
          commands.push(["metadata", tracks]);
        },
      }),
    },
    "@/features/tracks/events": {
      reportTracksChanged: (ids: readonly number[]) => {
        commands.push(["changed", ids]);
      },
    },
    "@/shared/notifications/center": {
      notify: (notice: NotificationInput) => {
        notices.push(notice);
      },
    },
    "@/shared/logging/logger": { logger: { error: (...args: unknown[]) => logs.push(args) } },
  });
  return { module, commands, notices, logs };
}
it("reread preserves individual successes/failures and refresh errors without invoking playback editing", async () => {
  const results = [
    { trackId: 7, databaseUpdated: true, error: null },
    { trackId: 9, databaseUpdated: false, error: "unreadable" },
  ];
  const test = action(results, true);
  const reread = test.module.useTrackReread();
  const outcome = await reread.reread([7, 9, 7]);
  expect(outcome).toEqual({ results, refreshError: "refresh unavailable" });
  expect(test.commands).toEqual([
    ["reread_track_tags", { trackIds: [7, 9] }],
    ["get_tracks", { trackIds: [7] }],
    ["changed", [7]],
  ]);
  expect(test.notices.map((notice) => notice.message)).toEqual([
    "1 首曲目读取失败。无法完成扫描。",
  ]);
  expect(test.logs).toEqual([
    ["tracks", "reread_failed", "unreadable", { trackId: 9 }],
    ["tracks", "refresh_failed", "refresh unavailable"],
  ]);
  expect(reread.pending.value).toBe(false);
});
it("reread stays silent on success, rejects empty targets, and resets pending on command failure", async () => {
  const results = [{ trackId: 7, databaseUpdated: true, error: null }];
  const success = action(results);
  const reread = success.module.useTrackReread();
  await reread.reread([]);
  expect(success.commands).toEqual([]);
  expect(await reread.reread([7])).toEqual({ results, refreshError: null });
  expect(success.notices.map((notice) => notice.message)).toEqual([]);
  const failed = action([], false, true);
  const reader = failed.module.useTrackReread();
  expect(await reader.reread([7])).toBeUndefined();
  expect(reader.pending.value).toBe(false);
  expect(failed.notices.map((notice) => notice.message)).toEqual(["标签读取失败。无法完成扫描。"]);
});
it("menu captures multi-selection before close, shows reading state and blocks duplicate clicks", async () => {
  const test = action([
    { trackId: 7, databaseUpdated: true, error: null },
    { trackId: 9, databaseUpdated: true, error: null },
  ]);
  const reader = test.module.useTrackReread();
  const module = evaluateSource<{ default: Vue.Component }>(menuOutput, {
    vue: Vue,
    "@/features/tracks/reread": { useTrackReread: () => reader },
  });
  const ids = Vue.ref([7, 9]);
  let closes = 0;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(
    Vue.defineComponent({
      setup: () => () =>
        Vue.h(module.default, {
          trackIds: ids.value,
          onClose: () => {
            closes++;
            ids.value = [];
          },
        }),
    }),
  );
  app.mount(root);
  try {
    const button = findNode(root, (node) => node.type === "button");
    if (!button || typeof button.props.onClick !== "function")
      throw new Error("Menu button missing");
    expect(getTextContent(root)).toBe("重新读取标签");
    button.props.onClick({ stopPropagation() {} });
    button.props.onClick({ stopPropagation() {} });
    expect(closes).toBe(1);
    await Vue.nextTick();
    expect(button.props.disabled).toBe(true);
    for (let index = 0; index < 15; index++) await Promise.resolve();
    expect(test.commands[0]).toEqual(["reread_track_tags", { trackIds: [7, 9] }]);
    expect(test.notices.map((notice) => notice.message)).toEqual([]);
  } finally {
    app.unmount();
  }
});

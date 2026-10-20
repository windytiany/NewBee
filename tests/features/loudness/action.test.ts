import { expect, it } from "bun:test";
import * as Vue from "vue";
import type { LoudnessProgress, LoudnessResult } from "@/features/loudness/api";
import type { useLoudness } from "@/features/loudness/useLoudness";
import type { NotificationInput } from "@/shared/notifications/center";
import type { TaskProgress, TaskResult } from "@/shared/tasks/state";
import { evaluateSource, transpileScript } from "../../support/module/loader";

const output = transpileScript(await Bun.file("src/features/loudness/useLoudness.ts").text());
const success: LoudnessResult = {
  trackId: 7,
  fileWritten: true,
  databaseUpdated: true,
  error: null,
};
function setup(
  options: { results?: LoudnessResult[]; confirm?: () => Promise<boolean>; fail?: boolean } = {},
) {
  const calls: Array<[string, unknown]> = [];
  const tasks: TaskProgress[] = [];
  const outcomes: Array<TaskResult | undefined> = [];
  const removed: string[] = [];
  const notices: NotificationInput[] = [];
  let confirmations = 0;
  class Channel {
    onmessage?: (value: LoudnessProgress) => void;
  }
  const module = evaluateSource<{ useLoudness: typeof useLoudness }>(output, {
    vue: Vue,
    "@/features/loudness/confirmation": {
      useLoudnessConfirmation: () => ({
        ask: async () => {
          confirmations++;
          return options.confirm ? options.confirm() : true;
        },
      }),
    },
    "@tauri-apps/api/core": {
      Channel,
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push([command, args]);
        if (command === "analyze_track_loudness" || command === "restore_track_loudness") {
          if (options.fail) throw new Error("write failed");
          (args!.onProgress as Channel).onmessage?.({ completed: 1, total: 1 });
          return options.results ?? [success];
        }
        if (command === "get_tracks") return [];
        throw new Error(`Unexpected command ${command}`);
      },
    },
    "@/features/playback/session": {
      usePlaybackSession: () => ({ updateTrackMetadata: async () => {} }),
    },
    "@/features/tracks/events": { reportTracksChanged: () => {} },
    "@/shared/logging/logger": { logger: { error: () => {} } },
    "@/shared/tasks/state": {
      tasks: {
        update: (task: TaskProgress) => tasks.push(task),
        finish: (key: string, result?: TaskResult) => {
          removed.push(key);
          outcomes.push(result);
        },
      },
    },
    "@/shared/notifications/center": {
      notify: (notice: NotificationInput) => notices.push(notice),
    },
  });
  return {
    action: module.useLoudness(),
    calls,
    tasks,
    removed,
    outcomes,
    notices,
    confirmations: () => confirmations,
  };
}

it("requires opt-in, deduplicates targets, reports progress and refreshes successful writes", async () => {
  const test = setup();
  expect(await test.action.analyze([7, 7])).toEqual([success]);
  expect(test.confirmations()).toBe(1);
  expect(test.calls[0]?.[0]).toBe("analyze_track_loudness");
  expect((test.calls[0]?.[1] as { trackIds: number[] }).trackIds).toEqual([7]);
  expect(test.calls[1]).toEqual(["get_tracks", { trackIds: [7] }]);
  expect(test.tasks.map(({ completed }) => completed)).toEqual([0, 1]);
  expect(test.removed).toEqual(["loudness-analysis"]);
  expect(test.notices.map(({ message }) => message)).toEqual(["响度分析完成"]);
  expect(test.action.pending.value).toBe(false);
});

it("analyzes temporary paths without registering files or treating absent database updates as failures", async () => {
  const test = setup({
    results: [{ trackId: null, fileWritten: true, databaseUpdated: false, error: null }],
  });
  await test.action.analyze([], ["/music/temporary.flac", "/music/temporary.flac"]);
  expect(test.calls).toHaveLength(1);
  expect(test.calls[0]?.[1] as { trackIds: number[]; paths: string[] }).toMatchObject({
    trackIds: [],
    paths: ["/music/temporary.flac"],
  });
  expect(test.notices[0]?.type).toBe("success");
});

it("does not write on cancellation or empty selection and blocks duplicate actions", async () => {
  let resolve!: (value: boolean) => void;
  const test = setup({
    confirm: () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  });
  await test.action.analyze([]);
  const first = test.action.analyze([7]);
  expect(test.action.pending.value).toBe(true);
  await test.action.analyze([9]);
  expect(test.confirmations()).toBe(1);
  resolve(false);
  await first;
  expect(test.calls).toEqual([]);
  expect(test.tasks).toEqual([]);
  expect(test.action.pending.value).toBe(false);
});

it("reports individual failures while refreshing successful results and always releases task state", async () => {
  const test = setup({
    results: [
      success,
      { trackId: 9, fileWritten: false, databaseUpdated: false, error: "readonly" },
    ],
  });
  await test.action.analyze([7, 9]);
  expect(test.calls[1]).toEqual(["get_tracks", { trackIds: [7] }]);
  expect(test.notices[0]?.message).toBe("1 首曲目响度分析失败");
  expect(test.outcomes).toEqual([{ type: "warning", message: "1 首曲目响度分析失败" }]);
  const failed = setup({ fail: true });
  await failed.action.analyze([7]);
  expect(failed.notices[0]?.message).toBe("响度分析失败");
  expect(failed.outcomes).toEqual([{ type: "error", message: "响度分析失败" }]);
  expect(failed.action.pending.value).toBe(false);
  expect(failed.removed).toEqual(["loudness-analysis"]);
});

it("restores tagged and already-original tracks, deduplicates paths, and refreshes registered tracks", async () => {
  const test = setup({ results: [success, { ...success, trackId: 9, fileWritten: false }] });
  await test.action.restore([7, 7, 9], ["/music/tone.flac", "/music/tone.flac"]);
  expect(test.confirmations()).toBe(1);
  expect(test.calls[0]?.[0]).toBe("restore_track_loudness");
  expect(test.calls[0]?.[1]).toMatchObject({ trackIds: [7, 9], paths: ["/music/tone.flac"] });
  expect(test.calls[1]).toEqual(["get_tracks", { trackIds: [7, 9] }]);
  expect(test.notices[0]).toMatchObject({ type: "success", message: "已恢复原始响度" });
  expect(test.removed).toEqual(["loudness-restoration"]);
  expect(test.action.pending.value).toBe(false);
});

it("accepts already-original temporary files without a database record", async () => {
  const test = setup({
    results: [{ trackId: null, fileWritten: false, databaseUpdated: false, error: null }],
  });
  await test.action.restore([], ["/music/tone.flac"]);
  expect(test.calls).toHaveLength(1);
  expect(test.notices[0]?.type).toBe("success");
});

it("cancels restoration and shares its busy guard with analysis", async () => {
  let resolve!: (value: boolean) => void;
  const test = setup({
    confirm: () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  });
  await test.action.restore([]);
  const restoring = test.action.restore([7]);
  await test.action.analyze([9]);
  expect(test.confirmations()).toBe(1);
  resolve(false);
  await restoring;
  expect(test.calls).toEqual([]);
  expect(test.action.pending.value).toBe(false);
});

it("reports restoration failures and releases the progress task", async () => {
  const test = setup({
    results: [
      success,
      { ...success, trackId: 9, error: "readonly", fileWritten: false, databaseUpdated: false },
    ],
  });
  await test.action.restore([7, 9]);
  expect(test.notices[0]?.message).toBe("1 首曲目恢复原始响度失败");
  const failed = setup({ fail: true });
  await failed.action.restore([7]);
  expect(failed.notices[0]?.message).toBe("恢复原始响度失败");
  expect(failed.action.pending.value).toBe(false);
  expect(failed.removed).toEqual(["loudness-restoration"]);
});

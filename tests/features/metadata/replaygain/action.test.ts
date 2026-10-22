import { expect, it } from "bun:test";
import * as Vue from "vue";
import type { ReplayGainProgress, ReplayGainResult } from "@/features/metadata/replaygain/api";
import type { useReplayGain } from "@/features/metadata/replaygain/useReplayGain";
import { createReplayGainConfirmation } from "@/features/metadata/replaygain/confirmation";
import type { NotificationInput } from "@/shared/notifications/center";
import type { TaskProgress, TaskResult } from "@/shared/tasks/state";
import { evaluateSource, transpileScript } from "../../../support/module/loader";

const output = transpileScript(
  await Bun.file("src/features/metadata/replaygain/useReplayGain.ts").text(),
);
const success: ReplayGainResult = {
  trackId: 7,
  fileWritten: true,
  databaseUpdated: true,
  error: null,
};
function setup(
  options: {
    results?: ReplayGainResult[];
    confirm?: (title: string, message: string) => Promise<boolean>;
    fail?: boolean;
  } = {},
) {
  const calls: Array<[string, unknown]> = [];
  const tasks: TaskProgress[] = [];
  const outcomes: Array<TaskResult | undefined> = [];
  const removed: string[] = [];
  const notices: NotificationInput[] = [];
  let confirmations = 0;
  class Channel {
    onmessage?: (value: ReplayGainProgress) => void;
  }
  const module = evaluateSource<{ useReplayGain: typeof useReplayGain }>(output, {
    vue: Vue,
    "@/features/metadata/replaygain/confirmation": {
      useReplayGainConfirmation: () => ({
        ask: async (title: string, message: string) => {
          confirmations++;
          return options.confirm ? options.confirm(title, message) : true;
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
    "@/shared/logging/logger": {
      logger: { error: () => {} },
      operationId: () => "replaygain-test",
    },
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
    action: module.useReplayGain(),
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
  // Progress and task lifetime are owned by the shared command queue.
  expect(test.tasks).toEqual([]);
  expect(test.removed).toEqual([]);
  expect(test.notices.map(({ message }) => message)).toEqual(["ReplayGain 分析完成"]);
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
  expect(test.notices[0]?.message).toBe("1 首曲目 ReplayGain 分析失败");
  expect(test.outcomes).toEqual([]);
  const failed = setup({ fail: true });
  await failed.action.analyze([7]);
  expect(failed.notices[0]?.message).toBe("ReplayGain 分析失败");
  expect(failed.outcomes).toEqual([]);
  expect(failed.action.pending.value).toBe(false);
  expect(failed.removed).toEqual([]);
});

it("removes ReplayGain tags, accepts untagged tracks, deduplicates paths, and refreshes registered tracks", async () => {
  const test = setup({ results: [success, { ...success, trackId: 9, fileWritten: false }] });
  await test.action.remove([7, 7, 9], ["/music/tone.flac", "/music/tone.flac"]);
  expect(test.confirmations()).toBe(1);
  expect(test.calls[0]?.[0]).toBe("restore_track_loudness");
  expect(test.calls[0]?.[1]).toMatchObject({ trackIds: [7, 9], paths: ["/music/tone.flac"] });
  expect(test.calls[1]).toEqual(["get_tracks", { trackIds: [7, 9] }]);
  expect(test.notices[0]).toMatchObject({ type: "success", message: "已移除 ReplayGain 标签" });
  expect(test.removed).toEqual([]);
  expect(test.action.pending.value).toBe(false);
});

it("accepts untagged temporary files without a database record", async () => {
  const test = setup({
    results: [{ trackId: null, fileWritten: false, databaseUpdated: false, error: null }],
  });
  await test.action.remove([], ["/music/tone.flac"]);
  expect(test.calls).toHaveLength(1);
  expect(test.notices[0]?.type).toBe("success");
});

it("cancels ReplayGain tag removal and shares its busy guard with analysis", async () => {
  let resolve!: (value: boolean) => void;
  const test = setup({
    confirm: () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  });
  await test.action.remove([]);
  const removing = test.action.remove([7]);
  expect(test.action.pending.value).toBe(true);
  await test.action.analyze([9]);
  expect(test.confirmations()).toBe(1);
  resolve(false);
  await removing;
  expect(test.calls).toEqual([]);
  expect(test.action.pending.value).toBe(false);
});

for (const operation of ["analyze", "remove"] as const) {
  it(`${operation} reports database synchronization failures even after a successful file write`, async () => {
    const test = setup({ results: [{ ...success, databaseUpdated: false }] });
    await test.action[operation]([7]);
    expect(test.calls).toHaveLength(1);
    expect(test.notices[0]?.type).toBe("warning");
    expect(test.outcomes).toEqual([]);
    expect(test.action.pending.value).toBe(false);
  });

  it(`${operation} keeps pending until confirmation and allows another operation after cancellation`, async () => {
    const confirmation = createReplayGainConfirmation();
    const test = setup({ confirm: confirmation.ask });
    const first = test.action[operation]([7]);
    expect(test.action.pending.value).toBe(true);
    expect(confirmation.state.value).toEqual(
      operation === "analyze"
        ? { title: "分析 ReplayGain", message: "重新测量并覆盖所选曲目的 ReplayGain 标签？" }
        : { title: "移除 ReplayGain 标签", message: "移除所选曲目的 ReplayGain 标签？" },
    );
    expect(test.calls).toEqual([]);
    await test.action.analyze([9]);
    await test.action.remove([9]);
    expect(test.confirmations()).toBe(1);
    confirmation.resolve(false);
    await first;
    expect(test.action.pending.value).toBe(false);
    expect(confirmation.state.value).toBeNull();
    expect(test.calls).toEqual([]);
    expect(test.tasks).toEqual([]);

    const second = test.action[operation]([7]);
    expect(test.action.pending.value).toBe(true);
    confirmation.resolve(true);
    await second;
    expect(test.confirmations()).toBe(2);
    expect(test.calls[0]?.[0]).toBe(
      operation === "analyze" ? "analyze_track_loudness" : "restore_track_loudness",
    );
    expect(test.action.pending.value).toBe(false);
    expect(confirmation.state.value).toBeNull();
  });
}

it("reports analysis file write failures even when the database is updated", async () => {
  const test = setup({ results: [{ ...success, fileWritten: false }] });
  await test.action.analyze([7]);
  expect(test.notices[0]).toMatchObject({
    type: "warning",
    message: "1 首曲目 ReplayGain 分析失败",
  });
  expect(test.calls[1]).toEqual(["get_tracks", { trackIds: [7] }]);
  expect(test.action.pending.value).toBe(false);
});

it("reports ReplayGain tag removal failures and releases the progress task", async () => {
  const test = setup({
    results: [
      success,
      { ...success, trackId: 9, error: "readonly", fileWritten: false, databaseUpdated: false },
    ],
  });
  await test.action.remove([7, 9]);
  expect(test.notices[0]?.message).toBe("1 首曲目 ReplayGain 标签移除失败");
  const failed = setup({ fail: true });
  await failed.action.remove([7]);
  expect(failed.notices[0]?.message).toBe("移除 ReplayGain 标签失败");
  expect(failed.action.pending.value).toBe(false);
  expect(failed.removed).toEqual([]);
});

import { Channel, invoke } from "@tauri-apps/api/core";
import { reactive, toRef } from "vue";
import { createLyricsApi } from "@/features/lyrics/api";
import { createLyricsBatchCooperation } from "@/features/lyrics/download/cooperation";
import type { LyricsBatchCooperationOptions } from "@/features/lyrics/download/cooperation";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import { createMetadataSave } from "@/features/tags/save";
import { notifications } from "@/shared/notifications/center";
import { usePlaybackSession } from "@/features/playback/session";
import type { LyricsBatchEvent, LyricsBatchOutcome } from "@/features/lyrics/types";

const TASK_KEY = "lyrics-download";
export type LyricsBatchOptions = LyricsBatchCooperationOptions & {
  synchronize: () => void | Promise<void>;
  notifications: Pick<typeof notifications, "notify" | "updateTask" | "removeTask">;
};

export function createLyricsBatch(options: LyricsBatchOptions) {
  // Terminal confirmations also refresh files whose commit reply did not reach the frontend.
  const synchronization = createMetadataSave({ ...options, refreshWrittenFiles: true });
  const state = reactive({
    synchronizationError: toRef(synchronization.state, "synchronizationError"),
    running: false,
    cancelling: false,
    completed: 0,
    total: 0,
    written: 0,
    updated: 0,
    missing: 0,
    instrumental: 0,
    failed: 0,
  });
  let requestCancellation: (() => void) | null = null;

  function cancel() {
    if (!state.running || state.cancelling || requestCancellation === null) return;
    state.cancelling = true;
    requestCancellation();
    report();
  }
  function report() {
    options.notifications.updateTask({
      key: TASK_KEY,
      message: `正在更新缺少的歌词 · 已写入 ${state.written} 首`,
      completed: state.completed,
      total: state.total,
      cancelling: state.cancelling,
      cancel,
    });
  }

  async function run(trackIds: readonly number[]) {
    if (state.running) return;
    synchronization.reset();
    Object.assign(state, {
      running: true,
      cancelling: false,
      completed: 0,
      total: 0,
      written: 0,
      updated: 0,
      missing: 0,
      instrumental: 0,
      failed: 0,
    });
    let failure = "";
    const outcomes = new Map<number, LyricsBatchOutcome>();
    function update() {
      const entries = [...outcomes.values()];
      Object.assign(state, {
        completed: entries.length,
        written: entries.filter((entry) => entry.kind === "available" && entry.result?.fileWritten)
          .length,
        updated: entries.filter((entry) => entry.result?.databaseUpdated).length,
        missing: entries.filter((entry) => entry.kind === "missing").length,
        instrumental: entries.filter(
          (entry) => entry.kind === "instrumental" && entry.result?.databaseUpdated,
        ).length,
        failed: entries.filter(
          (entry) => entry.error || (entry.result && !entry.result.databaseUpdated),
        ).length,
      });
      report();
    }
    const cooperation = createLyricsBatchCooperation(options, {
      started: (total) => {
        state.total = total;
        report();
      },
      outcome: (outcome) => {
        outcomes.set(outcome.trackId, outcome);
        update();
      },
    });
    requestCancellation = cooperation.cancel;
    report();
    try {
      const ids = [...new Set(trackIds)];
      if (!ids.length) throw new Error("没有可下载歌词的曲目。");
      state.total = ids.length;
      const summary = await cooperation.run(ids);
      outcomes.clear();
      for (const outcome of summary.results) outcomes.set(outcome.trackId, outcome);
      state.cancelling = summary.status === "cancelled";
      failure = summary.error || (summary.status === "failed" ? "歌词下载批次失败。" : "");
      update();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      requestCancellation = null;
      const results = [...outcomes.values()].flatMap((outcome) =>
        outcome.result ? [outcome.result] : [],
      );
      await synchronization.run({
        targets: results.map(({ trackId, path }) => ({ trackId, path })),
        writeTrackIds: [],
        execute: async () => results,
      });
      if (state.synchronizationError)
        failure = [failure, state.synchronizationError].filter(Boolean).join("\n");
      const firstError = [...outcomes.values()].find(
        (outcome) => outcome.error || outcome.result?.error,
      );
      const detail = firstError?.error || firstError?.result?.error;
      options.notifications.removeTask(TASK_KEY);
      options.notifications.notify({
        type: failure || state.failed ? "warning" : "success",
        message:
          failure ||
          `歌词更新${state.cancelling ? "已取消" : "完成"}：${state.written} 首已写入，${state.missing} 首未找到，${state.instrumental} 首纯音乐已标记，${state.failed} 首失败。${detail ? `\n${detail}` : ""}`,
      });
      state.running = false;
    }
  }

  return {
    state,
    cancel,
    startTracks: run,
    retrySynchronization: async () => {
      if (state.running) return;
      state.running = true;
      try {
        await synchronization.retrySynchronization();
        options.notifications.notify({
          type: state.synchronizationError ? "warning" : "success",
          message: state.synchronizationError || "歌词界面已刷新。",
        });
      } finally {
        state.running = false;
      }
    },
  };
}

let sharedBatch: ReturnType<typeof createLyricsBatch> | null = null;
export function useLyricsBatch() {
  if (sharedBatch) return sharedBatch;
  const session = usePlaybackSession();
  const api = createLyricsApi(invoke);
  sharedBatch = createLyricsBatch({
    run: (ids, receive) => {
      const onProgress = new Channel<LyricsBatchEvent>();
      onProgress.onmessage = receive;
      return api.run(ids, onProgress);
    },
    commitStep: api.commitStep,
    completeStep: api.completeStep,
    editFiles: session.withMetadataEditing,
    cancel: api.cancel,
    synchronize: () => {
      globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT));
    },
    notifications,
  });
  return sharedBatch;
}

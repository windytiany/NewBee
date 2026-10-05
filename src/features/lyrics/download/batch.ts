import { invoke } from "@tauri-apps/api/core";
import { reactive } from "vue";
import { createLyricsApi } from "@/features/lyrics/api";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import type { TagSaveResult } from "@/features/tags/types";
import { notifications } from "@/shared/notifications/center";
import { usePlaybackSession } from "@/features/playback/session";
import type { LyricsContent } from "@/features/lyrics/types";

const TASK_KEY = "lyrics-download";
export type LyricsBatchOptions = {
  begin: (trackIds: number[]) => Promise<number>;
  fetch: (batchId: number, trackId: number) => Promise<LyricsContent>;
  write: (batchId: number, trackId: number, text: string) => Promise<TagSaveResult>;
  mark: (batchId: number, trackId: number) => Promise<TagSaveResult>;
  cancel: (batchId: number) => Promise<void>;
  finish: (batchId: number) => Promise<void>;
  synchronize: () => void;
  notifications: Pick<typeof notifications, "notify" | "updateTask" | "removeTask">;
};
export function createLyricsBatch(options: LyricsBatchOptions) {
  const state = reactive({
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
  let activeBatchId: number | null = null;
  const cancellation = { pending: Promise.resolve(), error: "" };
  function cancel() {
    if (!state.running || state.cancelling) return;
    state.cancelling = true;
    if (activeBatchId !== null) {
      cancellation.pending = options.cancel(activeBatchId).catch((error) => {
        cancellation.error = `取消请求失败：${error instanceof Error ? error.message : String(error)}`;
      });
    }
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
    report();
    let batchId: number | null = null;
    let failure = "";
    let firstError = "";
    function recordFailure(error: unknown) {
      state.failed++;
      if (!firstError) firstError = error instanceof Error ? error.message : String(error);
    }
    cancellation.pending = Promise.resolve();
    cancellation.error = "";
    try {
      const ids = [...new Set(trackIds)];
      if (state.cancelling) return;
      if (!ids.length) throw new Error("没有可下载歌词的曲目。");
      state.total = ids.length;
      report();
      batchId = await options.begin(ids);
      activeBatchId = batchId;
      for (const trackId of ids) {
        if (state.cancelling) break;
        try {
          const content = await options.fetch(batchId, trackId);
          if (state.cancelling) break;
          if (content.kind === "available") {
            // Downloads do not hold playback command state; only the actual write releases the file.
            const result = await options.write(batchId, trackId, content.text);
            if (result.fileWritten) state.written++;
            if (result.databaseUpdated) state.updated++;
            else recordFailure(result.error ?? "歌词已写入，但数据库同步失败。");
          } else if (content.kind === "instrumental") {
            const result = await options.mark(batchId, trackId);
            if (result.databaseUpdated) {
              state.instrumental++;
              state.updated++;
            } else recordFailure(result.error ?? "无歌词标记保存失败。");
          } else state.missing++;
        } catch (error) {
          if (state.cancelling) break;
          recordFailure(error);
        }
        state.completed++;
        report();
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      await cancellation.pending;
      if (cancellation.error) failure = cancellation.error;
      if (batchId !== null) {
        try {
          await options.finish(batchId);
        } catch (error) {
          failure = `结束歌词任务失败：${error instanceof Error ? error.message : String(error)}`;
        }
      }
      activeBatchId = null;
      if (state.written > 0 || state.updated > 0) {
        try {
          options.synchronize();
        } catch (error) {
          failure = `歌词已写入，但界面刷新失败：${error instanceof Error ? error.message : String(error)}`;
        }
      }
      options.notifications.removeTask(TASK_KEY);
      options.notifications.notify({
        type: failure || state.failed ? "warning" : "success",
        message:
          failure ||
          `歌词更新${state.cancelling ? "已取消" : "完成"}：${state.written} 首已写入，${state.missing} 首未找到，${state.instrumental} 首纯音乐已标记，${state.failed} 首失败。${firstError ? `\n${firstError}` : ""}`,
      });
      state.running = false;
    }
  }
  return {
    state,
    cancel,
    startTracks: run,
  };
}

let sharedBatch: ReturnType<typeof createLyricsBatch> | null = null;
export function useLyricsBatch() {
  if (sharedBatch) return sharedBatch;
  const session = usePlaybackSession();
  const api = createLyricsApi(invoke);
  sharedBatch = createLyricsBatch({
    begin: api.begin,
    fetch: api.fetch,
    write: (batchId, trackId, text) =>
      session.withMetadataEditing([trackId], () => api.write(batchId, trackId, text)),
    mark: async (batchId, trackId) => {
      const [target] = await api.targets([trackId]);
      const save = () => api.mark(batchId, trackId);
      return target?.hasLyrics ? session.withMetadataEditing([trackId], save) : save();
    },
    cancel: api.cancel,
    finish: api.finish,
    synchronize: () => globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT)),
    notifications,
  });
  return sharedBatch;
}

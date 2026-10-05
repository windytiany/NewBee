import { invoke } from "@tauri-apps/api/core";
import { reactive } from "vue";
import type { LibraryAlbumSelection } from "@/library/selection";
import type { TrackSummary } from "@/library/model";
import { LIBRARY_CHANGED_EVENT } from "@/library/changes";
import type { MetadataSaveResult } from "@/metadata/model";
import { notifications } from "@/notification/center";
import { usePlaybackSession } from "@/playback/session";
import type { LyricsContent } from "@/lyricsDownload/model";

const TASK_KEY = "lyrics-download";
export type LyricsBatchOptions = {
  begin: (trackIds: number[]) => Promise<number>;
  fetch: (batchId: number, trackId: number) => Promise<LyricsContent>;
  write: (batchId: number, trackId: number, text: string) => Promise<MetadataSaveResult>;
  cancel: (batchId: number) => Promise<void>;
  finish: (batchId: number) => Promise<void>;
  loadAlbum: (album: LibraryAlbumSelection) => Promise<number[]>;
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
  async function run(loadIds: () => Promise<number[]>) {
    if (state.running) return;
    Object.assign(state, {
      running: true,
      cancelling: false,
      completed: 0,
      total: 0,
      written: 0,
      missing: 0,
      instrumental: 0,
      failed: 0,
    });
    report();
    let batchId: number | null = null;
    let failure = "";
    cancellation.pending = Promise.resolve();
    cancellation.error = "";
    try {
      const ids = [...new Set(await loadIds())];
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
            if (!result.databaseUpdated) state.failed++;
          } else if (content.kind === "instrumental") state.instrumental++;
          else state.missing++;
        } catch {
          if (state.cancelling) break;
          state.failed++;
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
      if (state.written > 0) {
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
          `歌词更新${state.cancelling ? "已取消" : "完成"}：${state.written} 首已写入，${state.missing} 首未找到，${state.instrumental} 首纯音乐，${state.failed} 首失败。`,
      });
      state.running = false;
    }
  }
  return {
    state,
    cancel,
    startTracks: (trackIds: readonly number[]) => run(() => Promise.resolve([...trackIds])),
    startAlbum: (album: LibraryAlbumSelection) => run(() => options.loadAlbum(album)),
  };
}

let sharedBatch: ReturnType<typeof createLyricsBatch> | null = null;
export function useLyricsBatch() {
  if (sharedBatch) return sharedBatch;
  const session = usePlaybackSession();
  sharedBatch = createLyricsBatch({
    begin: (trackIds) => invoke("begin_lyrics_download", { trackIds }),
    fetch: (batchId, trackId) => invoke("fetch_batch_lyrics", { batchId, trackId }),
    write: (batchId, trackId, text) =>
      session.withMetadataEditing([trackId], () =>
        invoke("write_batch_lyrics", { batchId, trackId, text }),
      ),
    cancel: (batchId) => invoke("cancel_lyrics_download", { batchId }),
    finish: (batchId) => invoke("finish_lyrics_download", { batchId }),
    loadAlbum: async (album) =>
      (await invoke<TrackSummary[]>("list_album_tracks", album)).map((track) => track.id),
    synchronize: () => globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT)),
    notifications,
  });
  return sharedBatch;
}

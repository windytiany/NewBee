import { invoke } from "@tauri-apps/api/core";
import { useReplayGainConfirmation } from "@/features/metadata/replaygain/confirmation";
import { ref } from "vue";
import { analyzeReplayGain, removeReplayGain } from "@/features/metadata/replaygain/api";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { usePlaybackSession } from "@/features/playback/session";
import { watchActivity } from "@/shared/lifecycle/activity";
import { logger, operationId } from "@/shared/logging/logger";
import { writeQueue, TaskCancelled } from "@/features/tasks/queue";
import { notify } from "@/shared/notifications/center";
import type { TaskResult } from "@/shared/tasks/state";
import { t } from "@/shared/i18n/locale";

const pending = ref(false);
watchActivity(pending);
const operations = {
  analyze: {
    update: analyzeReplayGain,
    title: "分析 ReplayGain",
    confirmation: "重新测量并覆盖所选曲目的 ReplayGain 标签？",
    success: "ReplayGain 分析完成",
    partial: "{count} 首曲目 ReplayGain 分析失败",
    failure: "ReplayGain 分析失败",
  },
  remove: {
    update: removeReplayGain,
    title: "移除 ReplayGain 标签",
    confirmation: "移除所选曲目的 ReplayGain 标签？",
    success: "已移除 ReplayGain 标签",
    partial: "{count} 首曲目 ReplayGain 标签移除失败",
    failure: "移除 ReplayGain 标签失败",
  },
} as const;

export function useReplayGain() {
  const synchronization = createTrackSynchronization(usePlaybackSession(), invoke);
  const confirmation = useReplayGainConfirmation();
  async function update(
    operation: keyof typeof operations,
    trackIds: readonly number[],
    paths: readonly string[] = [],
  ) {
    const ids = [...new Set(trackIds)];
    const files = [...new Set(paths)];
    if (pending.value || (!ids.length && !files.length)) return;
    const config = operations[operation];
    pending.value = true;
    let outcome: TaskResult | undefined;
    let submitted = false;
    try {
      if (!(await confirmation.ask(config.title, config.confirmation))) return;
      const id = operationId("replaygain");
      const request = config.update(ids, () => {}, files, id);
      submitted = true;
      pending.value = false;
      const results = await request;
      const failed = results.filter(
        (result) =>
          result.error ||
          (operation === "analyze" && !result.fileWritten) ||
          (result.trackId !== null && !result.databaseUpdated),
      );
      for (const result of failed)
        logger.error("metadata/replaygain", `${operation}_failed`, result.error, {
          trackId: result.trackId,
        });
      let refreshFailed = false;
      try {
        await synchronization.refresh(
          results.flatMap((result) =>
            result.databaseUpdated && result.trackId !== null ? [result.trackId] : [],
          ),
        );
      } catch (error) {
        refreshFailed = true;
        logger.error("metadata/replaygain", "refresh_failed", error);
      }
      const message = failed.length
        ? t(config.partial, { count: failed.length })
        : refreshFailed
          ? t("曲目信息刷新失败")
          : t(config.success);
      if (failed.length || refreshFailed) outcome = { type: "warning", message };
      if (!writeQueue.wasCancelled(id)) notify({ type: outcome?.type ?? "success", message });
      return results;
    } catch (error) {
      if (error instanceof TaskCancelled) return;
      logger.error("metadata/replaygain", `${operation}_failed`, error);
      outcome = { type: "error", message: t(config.failure) };
      notify(outcome);
    } finally {
      if (!submitted) pending.value = false;
    }
  }
  return {
    pending,
    analyze: (trackIds: readonly number[], paths?: readonly string[]) =>
      update("analyze", trackIds, paths),
    remove: (trackIds: readonly number[], paths?: readonly string[]) =>
      update("remove", trackIds, paths),
  };
}

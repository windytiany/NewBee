import { invoke } from "@tauri-apps/api/core";
import { useLoudnessConfirmation } from "@/features/loudness/confirmation";
import { ref } from "vue";
import { analyzeLoudness, restoreLoudness } from "@/features/loudness/api";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { usePlaybackSession } from "@/features/playback/session";
import { watchActivity } from "@/shared/lifecycle/activity";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { tasks, type TaskResult } from "@/shared/tasks/state";
import { t } from "@/shared/i18n/locale";

const pending = ref(false);
watchActivity(pending);
const operations = {
  analyze: {
    update: analyzeLoudness,
    taskKey: "loudness-analysis",
    title: "分析响度",
    confirmation: "重新测量并覆盖所选曲目的 ReplayGain 标签？",
    progress: "正在分析响度…",
    success: "响度分析完成",
    partial: "{count} 首曲目响度分析失败",
    failure: "响度分析失败",
  },
  restore: {
    update: restoreLoudness,
    taskKey: "loudness-restoration",
    title: "恢复原始响度",
    confirmation: "移除所选曲目的 ReplayGain 标签？",
    progress: "正在恢复原始响度…",
    success: "已恢复原始响度",
    partial: "{count} 首曲目恢复原始响度失败",
    failure: "恢复原始响度失败",
  },
} as const;

export function useLoudness() {
  const synchronization = createTrackSynchronization(usePlaybackSession(), invoke);
  const confirmation = useLoudnessConfirmation();
  async function update(
    operation: keyof typeof operations,
    trackIds: readonly number[],
    paths: readonly string[] = [],
  ) {
    const ids = [...new Set(trackIds)];
    const files = [...new Set(paths)];
    if (pending.value || (!ids.length && !files.length)) return;
    const config = operations[operation];
    const taskKey = config.taskKey;
    pending.value = true;
    let outcome: TaskResult | undefined;
    try {
      if (!(await confirmation.ask(config.title, config.confirmation))) return;
      tasks.update({
        key: taskKey,
        message: t(config.progress),
        completed: 0,
        total: ids.length + files.length,
      });
      const results = await config.update(
        ids,
        (progress) => {
          tasks.update({ key: taskKey, message: t(config.progress), ...progress });
        },
        files,
      );
      const failed = results.filter(
        (result) =>
          result.error ||
          (operation === "analyze" && !result.fileWritten) ||
          (result.trackId !== null && !result.databaseUpdated),
      );
      for (const result of failed)
        logger.error("loudness", `${operation}_failed`, result.error, { trackId: result.trackId });
      let refreshFailed = false;
      try {
        await synchronization.refresh(
          results.flatMap((result) =>
            result.databaseUpdated && result.trackId !== null ? [result.trackId] : [],
          ),
        );
      } catch (error) {
        refreshFailed = true;
        logger.error("loudness", "refresh_failed", error);
      }
      const message = failed.length
        ? t(config.partial, { count: failed.length })
        : refreshFailed
          ? t("曲目信息刷新失败")
          : t(config.success);
      if (failed.length || refreshFailed) outcome = { type: "warning", message };
      notify({ type: outcome?.type ?? "success", message });
      return results;
    } catch (error) {
      logger.error("loudness", `${operation}_failed`, error);
      outcome = { type: "error", message: t(config.failure) };
      notify(outcome);
    } finally {
      tasks.finish(taskKey, outcome);
      pending.value = false;
    }
  }
  return {
    pending,
    analyze: (trackIds: readonly number[], paths?: readonly string[]) =>
      update("analyze", trackIds, paths),
    restore: (trackIds: readonly number[], paths?: readonly string[]) =>
      update("restore", trackIds, paths),
  };
}

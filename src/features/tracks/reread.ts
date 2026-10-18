import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { usePlaybackSession } from "@/features/playback/session";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { t } from "@/shared/i18n/locale";

const pending = ref(false);
watchActivity(pending);

export function useTrackReread() {
  const synchronization = createTrackSynchronization(usePlaybackSession(), invoke);
  async function reread(trackIds: readonly number[]) {
    const ids = [...new Set(trackIds)];
    if (pending.value || !ids.length) return;
    pending.value = true;
    try {
      const outcome = await synchronization.reread(ids);
      const failed = outcome.results.filter((result) => !result.databaseUpdated || result.error);
      for (const result of failed)
        logger.error("tracks", "reread_failed", result.error, { trackId: result.trackId });
      if (outcome.refreshError) logger.error("tracks", "refresh_failed", outcome.refreshError);
      if (failed.length || outcome.refreshError)
        notify({
          type: "warning",
          message: failed.length
            ? t("{count} 首曲目读取失败。无法完成扫描。", { count: failed.length })
            : t("曲目信息刷新失败"),
        });
      return outcome;
    } catch (error) {
      logger.error("tracks", "reread_failed", error);
      notify({ type: "error", message: t("标签读取失败。无法完成扫描。") });
    } finally {
      pending.value = false;
    }
  }
  return { pending, reread };
}

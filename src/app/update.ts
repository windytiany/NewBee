import { onMounted, onUnmounted } from "vue";
import { getUpdater } from "@/shared/update/runtime";
import { createSettingsApi } from "@/features/settings/api";
import { logger } from "@/shared/logging/logger";
import { watchActivity } from "@/shared/lifecycle/activity";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

let started = false;

export function useStartupUpdates(openSettings: () => void) {
  const updater = getUpdater();
  const stop = watchActivity(updater.busy);
  onUnmounted(stop);
  onMounted(async () => {
    if (started || !updater.supported) return;
    started = true;
    try {
      const settings = await createSettingsApi().get();
      if (settings.checkUpdatesOnStartup === false) return;
    } catch (error) {
      logger.warn("update", "startup_preferences_failed", error);
      return;
    }
    await updater.check();
    if (updater.phase.value !== "available") return;
    notify({
      type: "info",
      message: t("发现新版本 {version}", { version: updater.version.value }),
      key: "application-update",
      action: { label: t("查看更新"), run: openSettings },
    });
  });
}

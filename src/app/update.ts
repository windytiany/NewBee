import { onMounted, onUnmounted } from "vue";
import { getUpdater } from "@/shared/update/runtime";
import { createSettingsApi } from "@/features/settings/api";
import { logger } from "@/shared/logging/logger";
import { watchActivity } from "@/shared/lifecycle/activity";

let started = false;

export function useStartupUpdates() {
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
  });
}

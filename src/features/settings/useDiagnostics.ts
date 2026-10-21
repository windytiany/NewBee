import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import type { Ref } from "vue";

export function useDiagnostics(isChangingLogging: Ref<boolean>) {
  const detailedLogging = ref(false);
  async function changeLogging() {
    if (isChangingLogging.value) return;
    isChangingLogging.value = true;
    try {
      await invoke<void>("set_detailed_logging", { enabled: detailedLogging.value });
    } catch (reason) {
      logger.error("settings", "logging_level_change_failed", reason);
      detailedLogging.value = !detailedLogging.value;
      notify({ type: "error", message: t("切换日志级别失败"), key: "settings-logging" });
    } finally {
      isChangingLogging.value = false;
    }
  }
  async function openLogs() {
    try {
      await invoke<void>("open_logs_directory");
    } catch (reason) {
      logger.error("settings", "open_logs_failed", reason);
      notify({ type: "error", message: t("打开日志目录失败"), key: "settings-logs" });
    }
  }
  return { detailedLogging, isChangingLogging, changeLogging, openLogs };
}

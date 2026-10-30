import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { createUpdater } from "@/shared/update/controller";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

let updater: ReturnType<typeof createUpdater> | undefined;

export async function checkForUpdates() {
  const current = getUpdater();
  await current.check();
  if (current.phase.value === "latest") {
    notify({ type: "success", message: t("已是最新版本"), key: "application-update" });
  } else if (current.phase.value === "idle" && current.error.value) {
    notify({ type: "error", message: t(current.error.value), key: "application-update" });
  }
}

export function getUpdater() {
  return (updater ??= createUpdater({
    supported: isTauri() && globalThis.navigator?.userAgent.includes("Windows") === true,
    check,
    failed: (event, error) => logger.error("update", event, error),
  }));
}

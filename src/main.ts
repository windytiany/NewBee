import { createApp } from "vue";
import "@/app/styles/main.css";
import { showMainWindow } from "@/app/startup";
import { installErrorLogging } from "@/app/logging";
import { restoreInterfaceState } from "@/features/backup/interface";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

globalThis.document.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  { capture: true },
);

async function start() {
  try {
    await restoreInterfaceState();
  } catch (error) {
    logger.error("backup", "interface_restore_failed", error);
    notify({ type: "error", message: t("恢复界面状态失败"), key: "backup-restore" });
  }
  const { default: App } = await import("@/app/App.vue");
  const app = createApp(App);
  installErrorLogging(app);
  app.mount("#app");
  await showMainWindow();
}

void start();

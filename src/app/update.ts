import { onMounted, onUnmounted, watch } from "vue";
import { getUpdater } from "@/shared/update/runtime";
import { watchActivity } from "@/shared/lifecycle/activity";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

let started = false;

export function waitForUpdates(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  const updater = getUpdater();
  if (!updater.holdsWindow.value) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      stop();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(signal.reason);
    };
    const stop = watch(
      updater.holdsWindow,
      (held) => {
        if (held) return;
        finish();
        resolve();
      },
      { flush: "sync" },
    );
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function useStartupUpdates(openSettings: () => void) {
  const updater = getUpdater();
  const stop = watchActivity(updater.busy);
  onUnmounted(stop);
  onMounted(async () => {
    if (started || !updater.supported) return;
    started = true;
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

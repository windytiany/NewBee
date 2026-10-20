import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { prepareRelease, waitForIdle } from "@/shared/lifecycle/activity";
import { createWindowRelease } from "@/app/window/release";
import { waitForUpdates } from "@/app/update";
import { logger } from "@/shared/logging/logger";
import { t } from "@/shared/i18n/locale";

let initialization: Promise<boolean> | undefined;

export function initializeLightweightMode() {
  if (!isTauri()) return Promise.resolve(false);
  return (initialization ??= install());
}

async function install() {
  const release = createWindowRelease({
    prepare: prepareRelease,
    hide: (request) => invoke<boolean>("advance_lightweight", { request, release: false }),
    idle: async (signal) => {
      await waitForIdle(signal);
      await waitForUpdates(signal);
    },
    release: async (request) => {
      await invoke("set_shortcuts_suspended", { suspended: false });
      await invoke("advance_lightweight", { request, release: true });
    },
    cancel: (request, fallback = false) => invoke("cancel_lightweight", { request, fallback }),
    failed: (error) => {
      logger.error("window", "lightweight_failed", error);
      void message(t("进入轻量模式失败"), { title: "NewBee", kind: "error" }).catch(
        (reason: unknown) => {
          logger.error("window", "lightweight_error_dialog_failed", reason);
        },
      );
    },
  });
  const stops: UnlistenFn[] = [];
  try {
    stops.push(
      await listen<number>("lightweight-requested", ({ payload }) => {
        void release.request(payload);
      }),
    );
    stops.push(await listen("lightweight-cancelled", () => release.cancel()));
  } catch (error) {
    stops.forEach((stop) => stop());
    logger.error("window", "lightweight_listener_failed", error);
    return false;
  }
  // The WebView owns these listeners. Destroying it releases both subscriptions.
  return true;
}

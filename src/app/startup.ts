import { logger } from "@/shared/logging/logger";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { nextTick } from "vue";
import { restorePreferences } from "@/features/settings/preferences";
import { initializeLightweightMode } from "@/app/window/lightweight";

export async function showMainWindow() {
  if (!isTauri()) return;

  try {
    await restorePreferences();
    const lightweightReady = await initializeLightweightMode();
    await nextTick();
    // nextTick flushes DOM updates; the second frame runs after the first paint.
    await new Promise<void>((resolve) => {
      globalThis.requestAnimationFrame(() => {
        globalThis.requestAnimationFrame(() => resolve());
      });
    });
    await invoke("show_main_window", { lightweightReady });
  } catch (error) {
    logger.warn("app/startup", "Could not show the main window after startup.", error);
  }
}

import { logger } from "@/shared/logging/logger";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { nextTick } from "vue";
import { restorePreferences } from "@/features/settings/preferences";
import { initializeLightweightMode } from "@/app/window/lightweight";

export async function prepareMainWindow() {
  if (!isTauri()) return;
  await restorePreferences();
  await invoke("prepare_main_window");
  await waitForLayout(false);
}

function nextLayoutOpportunity() {
  return new Promise<void>((resolve) => {
    let frame = 0;
    const finish = () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      resolve();
    };
    // Occluded WebViews may pause animation frames. Layout can still be
    // flushed and checked without exposing an intermediate native window.
    const timer = setTimeout(finish, 32);
    frame = requestAnimationFrame(finish);
  });
}

async function waitForLayout(requireContent = true) {
  await nextTick();
  await document.fonts.ready;
  const appWindow = getCurrentWindow();
  let previous = "";
  let stableFrames = 0;
  const requiredFrames = requireContent ? 3 : 1;
  while (stableFrames < requiredFrames) {
    await nextLayoutOpportunity();
    // Re-read native bounds: a display/DPI change can occur during startup.
    const size = await appWindow.innerSize();
    const bounds = document.getElementById("app")?.getBoundingClientRect();
    const hasLayout =
      !requireContent || (bounds !== undefined && bounds.width > 0 && bounds.height > 0);
    const viewport = `${window.innerWidth}:${window.innerHeight}:${window.devicePixelRatio}`;
    const matchesNativeSize =
      Math.abs(window.innerWidth - size.width / window.devicePixelRatio) <= 1 &&
      Math.abs(window.innerHeight - size.height / window.devicePixelRatio) <= 1;
    stableFrames = hasLayout && matchesNativeSize && viewport === previous ? stableFrames + 1 : 0;
    previous = viewport;
  }
}

export async function showMainWindow() {
  if (!isTauri()) return;
  const lightweightReady = await initializeLightweightMode();
  await waitForLayout();
  await invoke("show_main_window", { lightweightReady });
}

export async function reportStartupFailure(error: unknown) {
  logger.error("app/startup", "Could not prepare the main window.", error);
  if (!isTauri()) return;
  try {
    await invoke("fail_startup", { error: String(error) });
  } catch (reason) {
    logger.error("app/startup", "Could not report startup failure.", reason);
  }
}

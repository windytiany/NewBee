import { isTauri } from "@tauri-apps/api/core";
import { logger } from "@/shared/logging/logger";
import { createSettingsApi } from "@/features/settings/api";
import { applyTheme } from "@/features/settings/theme";
import { applyReducedMotion } from "@/features/settings/motion";
import type { Settings } from "@/features/settings/types";

const api = createSettingsApi();

export function applyAppearance(settings: Pick<Settings, "theme" | "reducedMotion">) {
  applyTheme(settings.theme);
  applyReducedMotion(settings.reducedMotion);
}

export async function restoreAppearance() {
  if (!isTauri()) return;
  try {
    applyAppearance(await api.get());
  } catch (error) {
    logger.warn("features/settings/appearance", "Could not restore the saved appearance.", error);
  }
}

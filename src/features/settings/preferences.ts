import { setLocale } from "@/shared/i18n/locale";
import { isTauri } from "@tauri-apps/api/core";
import { logger } from "@/shared/logging/logger";
import { createSettingsApi } from "@/features/settings/api";
import { applyAppearance } from "@/features/settings/appearance";

const api = createSettingsApi();

export async function restorePreferences() {
  if (!isTauri()) return;
  try {
    const settings = await api.get();
    setLocale(settings.locale);
    applyAppearance(settings);
  } catch (error) {
    logger.warn("features/settings/preferences", "Could not restore the saved preferences.", error);
  }
}

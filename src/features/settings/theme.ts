import { logger } from "@/shared/logging/logger";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createSettingsApi } from "@/features/settings/api";

const api = createSettingsApi(invoke);

export const THEMES = [
  { value: "spotify", label: "Spotify" },
  { value: "tokyoNight", label: "Tokyo Night · Night" },
  { value: "catppuccin", label: "Catppuccin · Mocha" },
] as const;

export type Theme = (typeof THEMES)[number]["value"];

export function applyTheme(theme: Theme) {
  globalThis.document.documentElement.dataset.theme = theme;
}

export async function restoreTheme() {
  if (!isTauri()) return;
  try {
    const settings = await api.get();
    applyTheme(settings.theme);
  } catch (error) {
    logger.warn("features/settings/theme", "Could not restore the saved theme.", error);
  }
}

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Settings } from "@/settings/types";

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
    const settings = await invoke<Settings>("get_settings");
    applyTheme(settings.theme);
  } catch (error) {
    globalThis.console.error("Could not restore the saved theme.", error);
  }
}

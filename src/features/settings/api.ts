import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "@/features/settings/types";

export function createSettingsApi(invokeCommand: typeof invoke = invoke) {
  return {
    get: () => invokeCommand<Settings>("get_settings"),
    save: (settings: Settings) => invokeCommand<void>("save_settings", { settings }),
  };
}

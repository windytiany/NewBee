import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { createUpdater } from "@/shared/update/controller";
import { logger } from "@/shared/logging/logger";

let updater: ReturnType<typeof createUpdater> | undefined;

export function getUpdater() {
  return (updater ??= createUpdater({
    supported: isTauri() && globalThis.navigator?.userAgent.includes("Windows") === true,
    check,
    failed: (event, error) => logger.error("update", event, error),
  }));
}

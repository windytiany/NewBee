import { t } from "@/shared/i18n/locale";
import { logger, operationId } from "@/shared/logging/logger";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ref } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import { notifications, notify } from "@/shared/notifications/center";
import { reportLibraryImport } from "@/features/library/events";
import type { IngestResult } from "@/features/library/types";

type ScanProgress = { operationId: string; completed: number; total: number };
const TASK_KEY = "library-scan";
const isScanning = ref(false);
watchActivity(isScanning);
const scanResult = ref<IngestResult | null>(null);
const scanError = ref("");

export function useLibraryScan() {
  async function scanMusicLibrary() {
    if (isScanning.value) return;

    isScanning.value = true;
    scanResult.value = null;
    scanError.value = "";
    const id = operationId("library-import");
    const started = performance.now();
    let unlisten: UnlistenFn | undefined;
    notifications.updateTask({
      key: TASK_KEY,
      message: t("正在扫描…"),
      completed: 0,
    });
    try {
      unlisten = await listen<ScanProgress>("library-scan-progress", ({ payload }) => {
        if (payload.operationId !== id) return;
        notifications.updateTask({
          key: TASK_KEY,
          message: t("正在扫描…"),
          completed: payload.completed,
          total: payload.total || undefined,
        });
      });
      logger.info("library", "import_started", { operationId: id });
      scanResult.value = await invoke<IngestResult>("scan_music_library", { operationId: id });
      const result = scanResult.value;
      logger.info("library", "import_completed", {
        operationId: id,
        elapsedMs: Math.round(performance.now() - started),
        ...result,
      });
      notify({
        type: result.failed > 0 ? "warning" : "success",
        message: result.failed
          ? t("扫描完成，{count} 首失败（详情见日志）", { count: result.failed })
          : result.added === 0 && result.updated === 0
            ? t("未发现变化")
            : t("扫描完成：新增 {added} 首，更新 {updated} 首", {
                added: result.added,
                updated: result.updated,
              }),
        key: "library-scan",
      });
      reportLibraryImport(result);
    } catch (error) {
      scanError.value = error instanceof Error ? error.message : String(error);
      logger.error("library", "scan_failed", error, { operationId: id });
      notify({ type: "error", message: t("扫描失败，请查看日志"), key: "library-scan" });
    } finally {
      unlisten?.();
      notifications.removeTask(TASK_KEY);
      isScanning.value = false;
    }
  }

  return { isScanning, scanResult, scanError, scanMusicLibrary };
}

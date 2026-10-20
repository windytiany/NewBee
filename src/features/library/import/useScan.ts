import { t } from "@/shared/i18n/locale";
import { logger, operationId } from "@/shared/logging/logger";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, ref } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import { notify } from "@/shared/notifications/center";
import { tasks, type TaskResult } from "@/shared/tasks/state";
import { reportLibraryImport } from "@/features/library/events";
import { monitoringSnapshot } from "@/features/library/monitoring/state";
import type { IngestResult } from "@/features/library/types";

type ScanProgress = { operationId: string; completed: number; total: number };
const TASK_KEY = "library-scan";
const isScanning = ref(false);
const scanActive = computed(() => isScanning.value || monitoringSnapshot.value.progress != null);
watchActivity(scanActive);
const scanResult = ref<IngestResult | null>(null);
const scanError = ref("");

export function useLibraryScan() {
  async function scanMusicLibrary() {
    if (scanActive.value) return;

    isScanning.value = true;
    scanResult.value = null;
    scanError.value = "";
    const id = operationId("library-import");
    const started = performance.now();
    let unlisten: UnlistenFn | undefined;
    let outcome: TaskResult | undefined;
    tasks.update({
      key: TASK_KEY,
      message: t("正在扫描…"),
      completed: 0,
    });
    try {
      unlisten = await listen<ScanProgress>("library-scan-progress", ({ payload }) => {
        if (payload.operationId !== id) return;
        tasks.update({
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
      const message = result.failed
        ? t("扫描完成，{count} 首失败（详情见日志）", { count: result.failed })
        : result.added === 0 && result.updated === 0
          ? t("未发现变化")
          : t("扫描完成：新增 {added} 首，更新 {updated} 首", {
              added: result.added,
              updated: result.updated,
            });
      if (result.failed > 0) outcome = { type: "warning", message };
      notify({ type: outcome?.type ?? "success", message, key: TASK_KEY });
      reportLibraryImport(result);
    } catch (error) {
      scanError.value = error instanceof Error ? error.message : String(error);
      logger.error("library", "scan_failed", error, { operationId: id });
      outcome = { type: "error", message: t("扫描失败，请查看日志") };
      notify({ ...outcome, key: TASK_KEY });
    } finally {
      unlisten?.();
      tasks.finish(TASK_KEY, outcome);
      isScanning.value = false;
    }
  }

  return { isScanning: scanActive, scanResult, scanError, scanMusicLibrary };
}

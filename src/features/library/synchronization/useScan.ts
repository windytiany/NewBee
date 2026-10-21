import { computed, ref } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { t } from "@/shared/i18n/locale";
import { logger, operationId } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { commandFailure, errorMessage } from "@/shared/notifications/error";
import { watchActivity } from "@/shared/lifecycle/activity";
import {
  synchronizationSnapshot,
  refreshSynchronization,
} from "@/features/library/synchronization/state";
import type { IngestResult } from "@/features/library/types";

const isScanning = ref(false);
const scanActive = computed(
  () =>
    isScanning.value ||
    Boolean(synchronizationSnapshot.value.progress) ||
    synchronizationSnapshot.value.statuses.some(({ phase }) => phase === "scanning"),
);
watchActivity(scanActive);
const scanResult = ref<IngestResult | null>(null);
const scanError = ref("");

export function useLibrarySynchronization() {
  async function synchronizeLibrary() {
    if (!isTauri() || scanActive.value) return;
    isScanning.value = true;
    scanResult.value = null;
    scanError.value = "";
    const id = operationId("library-synchronization");
    const started = performance.now();
    try {
      logger.debug("library/synchronization", "started", { operationId: id });
      const result = await invoke<IngestResult>("synchronize_library", { operationId: id });
      scanResult.value = result;
      logger.write(result.failed ? "warn" : "info", "library/synchronization", "completed", {
        operationId: id,
        elapsedMs: Math.round(performance.now() - started),
        ...result,
      });
      const message = result.failed
        ? t("扫描完成，{count} 首失败", { count: result.failed })
        : result.added === 0 && result.updated === 0
          ? t("未发现变化")
          : t("扫描完成：新增 {added} 首，更新 {updated} 首", {
              added: result.added,
              updated: result.updated,
            });
      notify({
        type: result.failed ? "warning" : "success",
        message,
        key: "library-synchronization",
      });
      try {
        await refreshSynchronization();
      } catch (error) {
        logger.warn("library/synchronization", "snapshot_refresh_failed", error);
      }
    } catch (error) {
      scanError.value = errorMessage(error, t("扫描失败"));
      const busy = commandFailure(error)?.code === "write_busy";
      logger[busy ? "warn" : "error"]("library/synchronization", "failed", error, {
        operationId: id,
      });
      notify({
        type: busy ? "warning" : "error",
        message: scanError.value,
        key: "library-synchronization",
      });
    } finally {
      isScanning.value = false;
    }
  }
  return { isScanning: scanActive, scanResult, scanError, synchronizeLibrary: synchronizeLibrary };
}

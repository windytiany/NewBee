import { shallowRef } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { MonitoringSnapshot } from "@/features/library/monitoring/types";
import { tasks } from "@/shared/tasks/state";
import { t } from "@/shared/i18n/locale";

export const monitoringSnapshot = shallowRef<MonitoringSnapshot>({ statuses: [], missing: [] });
let sequence = 0;

export async function refreshMonitoring() {
  const request = ++sequence;
  const snapshot = await invoke<MonitoringSnapshot>("get_library_monitoring");
  if (request !== sequence) return;
  monitoringSnapshot.value = snapshot;
  if (snapshot.progress) {
    tasks.update({
      key: "library-monitoring",
      message: t("正在扫描…"),
      completed: snapshot.progress.completed,
      total: snapshot.progress.total || undefined,
    });
  } else {
    tasks.finish(
      "library-monitoring",
      snapshot.statuses.some((status) => status.phase === "error" || status.phase === "unavailable")
        ? { type: "error", message: t("扫描失败") }
        : undefined,
    );
  }
}

export async function resolveMonitoring(paths: readonly string[], clean: boolean) {
  const removed = await invoke<number>("resolve_library_monitoring", { paths: [...paths], clean });
  ++sequence;
  const resolved = new Set(paths);
  monitoringSnapshot.value = {
    ...monitoringSnapshot.value,
    missing: monitoringSnapshot.value.missing.filter((path) => !resolved.has(path)),
  };
  return removed;
}

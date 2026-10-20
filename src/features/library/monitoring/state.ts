import { shallowRef } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { MonitoringSnapshot } from "@/features/library/monitoring/types";
import { notifications } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

export const monitoringSnapshot = shallowRef<MonitoringSnapshot>({ statuses: [], missing: [] });
let sequence = 0;

export async function refreshMonitoring() {
  const request = ++sequence;
  const snapshot = await invoke<MonitoringSnapshot>("get_library_monitoring");
  if (request !== sequence) return;
  monitoringSnapshot.value = snapshot;
  if (snapshot.progress) {
    notifications.updateTask({
      key: "library-monitoring",
      message: t("正在扫描…"),
      completed: snapshot.progress.completed,
      total: snapshot.progress.total || undefined,
    });
  } else {
    notifications.removeTask("library-monitoring");
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

import { shallowRef } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { MonitoringSnapshot } from "@/features/library/monitoring/types";

export const monitoringSnapshot = shallowRef<MonitoringSnapshot>({ statuses: [], missing: [] });
let sequence = 0;

export async function refreshMonitoring() {
  const request = ++sequence;
  const snapshot = await invoke<MonitoringSnapshot>("get_library_monitoring");
  if (request === sequence) monitoringSnapshot.value = snapshot;
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

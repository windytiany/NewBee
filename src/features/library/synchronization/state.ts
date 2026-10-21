import { shallowRef } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { SynchronizationSnapshot } from "@/features/library/synchronization/types";
import { tasks } from "@/shared/tasks/state";
import { t } from "@/shared/i18n/locale";

export const synchronizationSnapshot = shallowRef<SynchronizationSnapshot>({
  statuses: [],
  missing: [],
});
let sequence = 0;

export async function refreshSynchronization() {
  const request = ++sequence;
  const snapshot = await invoke<SynchronizationSnapshot>("get_library_synchronization");
  if (request !== sequence) return;
  synchronizationSnapshot.value = snapshot;
  if (snapshot.progress || snapshot.statuses.some(({ phase }) => phase === "scanning")) {
    tasks.update({
      key: "library-synchronization",
      message: t("正在扫描…"),
      completed: snapshot.progress?.completed ?? 0,
      total: snapshot.progress?.total || undefined,
    });
  } else {
    tasks.finish(
      "library-synchronization",
      snapshot.statuses.some((status) => status.phase === "error" || status.phase === "unavailable")
        ? { type: "error", message: t("扫描失败") }
        : undefined,
    );
  }
}

export async function resolveSynchronization(paths: readonly string[], clean: boolean) {
  const removed = await invoke<number>("resolve_library_synchronization", {
    paths: [...paths],
    clean,
  });
  ++sequence;
  const resolved = new Set(paths);
  synchronizationSnapshot.value = {
    ...synchronizationSnapshot.value,
    missing: synchronizationSnapshot.value.missing.filter((path) => !resolved.has(path)),
  };
  return removed;
}

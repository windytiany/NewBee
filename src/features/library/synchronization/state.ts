import { shallowRef } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { SynchronizationSnapshot } from "@/features/library/synchronization/types";
import { tasks, type TaskResult } from "@/shared/tasks/state";
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
    const errors = snapshot.statuses.filter(
      ({ phase }) => phase === "error" || phase === "unavailable",
    );
    const issues = snapshot.statuses.reduce(
      (sum, status) => ({
        failed: sum.failed + (status.issues?.failed ?? 0),
        replayGainFailed: sum.replayGainFailed + (status.issues?.replayGainFailed ?? 0),
      }),
      { failed: 0, replayGainFailed: 0 },
    );
    const details = errors.map(({ path }) => t("无法扫描文件夹：{path}", { path }));
    if (issues.replayGainFailed) {
      details.push(
        t("ReplayGain 失败 {count} 首，未改写原文件", { count: issues.replayGainFailed }),
      );
    }
    let result: TaskResult | undefined;
    if (errors.length) {
      result = {
        type: "error",
        message:
          errors.length === snapshot.statuses.length ? t("扫描失败") : t("部分文件夹扫描失败"),
        details,
      };
    } else if (issues.failed) {
      result = {
        type: "warning",
        message: t("扫描完成，{count} 个文件处理异常", { count: issues.failed }),
        details,
      };
    }
    tasks.finish("library-synchronization", result);
    return result;
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

import { invoke, isTauri } from "@tauri-apps/api/core";
import { ref } from "vue";
import { notify } from "@/shared/notifications/center";

export function usePathMigration() {
  const oldPath = ref("");
  const newPath = ref("");
  const isMigrating = ref(false);
  const isTauriApp = isTauri();

  async function migrate() {
    if (!isTauriApp || isMigrating.value) return;
    const source = oldPath.value.trim();
    const target = newPath.value.trim();
    if (!source || !target || source === target) {
      notify({
        type: "warning",
        message: "请输入不同且非空的原路径和新路径。",
        key: "path-migration",
      });
      return;
    }
    isMigrating.value = true;
    try {
      const count = await invoke<number>("migrate_track_paths", {
        oldPath: source,
        newPath: target,
      });
      notify({
        type: count > 0 ? "success" : "info",
        message:
          count > 0
            ? `路径迁移完成：已更新 ${count} 首曲目。`
            : "没有曲目匹配原路径前缀，未修改数据库。",
        key: "path-migration",
      });
      return count > 0;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      notify({ type: "error", message: `路径迁移失败：${message}`, key: "path-migration" });
    } finally {
      isMigrating.value = false;
    }
  }

  return { oldPath, newPath, isMigrating, isTauriApp, migrate };
}

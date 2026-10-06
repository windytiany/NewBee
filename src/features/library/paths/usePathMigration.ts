import { invoke, isTauri } from "@tauri-apps/api/core";
import { ref } from "vue";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";

export function usePathMigration() {
  const migrationError = ref("");
  const oldPath = ref("");
  const newPath = ref("");
  const isMigrating = ref(false);
  const isTauriApp = isTauri();

  async function migrate() {
    if (!isTauriApp || isMigrating.value) return;
    const source = oldPath.value.trim();
    const target = newPath.value.trim();
    if (!source || !target || source === target) {
      migrationError.value = "请输入不同且非空的原路径和新路径";
      return;
    }
    migrationError.value = "";
    isMigrating.value = true;
    try {
      const count = await invoke<number>("migrate_track_paths", {
        oldPath: source,
        newPath: target,
      });
      logger.info("library", "paths_migrated", { count });
      if (count > 0) notify({ type: "success", message: `已更新 ${count} 首曲目的路径` });
      else migrationError.value = "没有匹配原路径的曲目";
      return count > 0;
    } catch (reason) {
      logger.error("library", "path_migration_failed", reason);
      migrationError.value = "路径迁移失败，请重试或查看日志";
    } finally {
      isMigrating.value = false;
    }
  }

  return { migrationError, oldPath, newPath, isMigrating, isTauriApp, migrate };
}

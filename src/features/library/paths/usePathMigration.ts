import { t } from "@/shared/i18n/locale";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ref } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";

export function usePathMigration() {
  const oldPath = ref("");
  const newPath = ref("");
  const isMigrating = ref(false);
  watchActivity(isMigrating);
  const isTauriApp = isTauri();

  async function migrate() {
    if (!isTauriApp || isMigrating.value) return;
    const source = oldPath.value.trim();
    const target = newPath.value.trim();
    if (!source || !target || source === target) {
      notify({
        type: "warning",
        message: t("请输入不同且非空的原路径和新路径"),
        key: "library-path-migration",
      });
      return;
    }
    isMigrating.value = true;
    try {
      const count = await invoke<number>("migrate_library_paths", {
        oldPath: source,
        newPath: target,
      });
      logger.info("library", "paths_migrated", { count });
      if (count > 0) notify({ type: "success", message: t("已更新 {count} 条路径", { count }) });
      else {
        notify({
          type: "warning",
          message: t("没有匹配原路径的记录"),
          key: "library-path-migration",
        });
      }
      return count > 0;
    } catch (reason) {
      logger.error("library", "path_migration_failed", reason);
      notify({
        type: "error",
        message: t("路径迁移失败，请查看日志"),
        key: "library-path-migration",
      });
    } finally {
      isMigrating.value = false;
    }
  }

  return { oldPath, newPath, isMigrating, isTauriApp, migrate };
}

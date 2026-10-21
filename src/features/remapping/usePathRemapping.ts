import { invoke, isTauri } from "@tauri-apps/api/core";
import { ref } from "vue";
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { watchActivity } from "@/shared/lifecycle/activity";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";

export function usePathRemapping() {
  const oldPath = ref("");
  const newPath = ref("");
  const isRemapping = ref(false);
  watchActivity(isRemapping);
  const isTauriApp = isTauri();
  async function remap() {
    if (!isTauriApp || isRemapping.value) return;
    const source = oldPath.value.trim();
    const target = newPath.value.trim();
    if (!source || !target || source === target) {
      notify({
        type: "warning",
        message: t("请输入不同且非空的原路径和新路径"),
        key: "path-remapping",
      });
      return;
    }
    isRemapping.value = true;
    try {
      const count = await invoke<number>("remap_paths", { oldPath: source, newPath: target });
      logger.info("remapping", "completed", { count });
      if (count > 0) {
        notify({ type: "success", message: t("已更新 {count} 条路径", { count }) });
        globalThis.window?.dispatchEvent(new globalThis.Event(SETTINGS_CHANGED_EVENT));
      } else notify({ type: "warning", message: t("没有匹配原路径的记录"), key: "path-remapping" });
      return count > 0;
    } catch (reason) {
      logger.error("remapping", "failed", reason);
      notify({ type: "error", message: t("路径重映射失败"), key: "path-remapping" });
    } finally {
      isRemapping.value = false;
    }
  }
  return { oldPath, newPath, isRemapping, isTauriApp, remap };
}

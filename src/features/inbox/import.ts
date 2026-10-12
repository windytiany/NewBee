import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ref } from "vue";
import { createInboxApi, INBOX_CHANGED_EVENT } from "@/features/inbox/api";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { t } from "@/shared/i18n/locale";
const pending = ref(false);
export function useInboxImport() {
  async function importFiles(directory: boolean) {
    if (pending.value || !isTauri()) return;
    pending.value = true;
    try {
      const extensions = await invoke<string[]>("supported_audio_extensions");
      const picked = await open({
        title: t("导入音频文件"),
        directory,
        multiple: true,
        ...(directory ? {} : { filters: [{ name: t("支持的音频文件"), extensions }] }),
      });
      if (!picked) return;
      const results = await createInboxApi().register(
        Array.isArray(picked) ? picked : [picked],
        directory,
      );
      for (const result of results)
        if (result.error)
          logger.warn("inbox", "register_failed", result.error, { path: result.path });
      const failed = results.filter((result) => !result.success).length;
      notify({
        type: failed ? "warning" : "success",
        message: failed
          ? t("导入完成，{count} 首失败（详情见日志）", { count: failed })
          : t("已加入 Inbox：{count} 首", {
              count: results.filter((result) => result.success && !result.skipped).length,
            }),
        key: "inbox-import",
      });
      globalThis.window.dispatchEvent(new globalThis.Event(INBOX_CHANGED_EVENT));
    } catch (error) {
      logger.error("inbox", "register_failed", error);
      notify({ type: "error", message: t("导入失败，请查看日志"), key: "inbox-import" });
    } finally {
      pending.value = false;
    }
  }
  return { pending, importFiles };
}

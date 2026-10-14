import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ref } from "vue";
import { createInboxApi, INBOX_CHANGED_EVENT } from "@/features/inbox/api";
import { reportLibraryMembershipChanged } from "@/features/library/events";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { t } from "@/shared/i18n/locale";
const pending = ref(false);
export function useInboxImport() {
  async function runImport(directory: boolean, droppedPaths?: string[]) {
    if (pending.value || !isTauri()) return;
    pending.value = true;
    try {
      const picked = droppedPaths
        ? await invoke<string[]>("readable_audio_files", { paths: droppedPaths })
        : await pickFiles(directory);
      if (!picked || picked.length === 0) return;
      const results = await createInboxApi().register(
        Array.isArray(picked) ? picked : [picked],
        directory,
      );
      for (const result of results)
        if (result.error)
          logger.warn("inbox", "register_failed", result.error, { path: result.path });
      const failed = results.filter((result) => !result.success).length;
      if (failed)
        notify({
          type: "warning",
          message: t("导入完成，{count} 首失败（详情见日志）", { count: failed }),
          key: "inbox-import",
        });
      if (results.some((result) => result.success && !result.skipped))
        reportLibraryMembershipChanged();
      globalThis.window.dispatchEvent(new globalThis.Event(INBOX_CHANGED_EVENT));
    } catch (error) {
      logger.error("inbox", "register_failed", error);
      notify({ type: "error", message: t("导入失败，请查看日志"), key: "inbox-import" });
    } finally {
      pending.value = false;
    }
  }
  async function pickFiles(directory: boolean) {
    const extensions = await invoke<string[]>("supported_audio_extensions");
    return open({
      title: t("导入音频文件"),
      directory,
      multiple: true,
      ...(directory ? {} : { filters: [{ name: t("支持的音频文件"), extensions }] }),
    });
  }

  return {
    pending,
    importFiles: (directory: boolean) => runImport(directory),
    importPaths: (paths: string[]) => runImport(false, paths),
  };
}

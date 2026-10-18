import { t } from "@/shared/i18n/locale";
import { logger, operationId } from "@/shared/logging/logger";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ref } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import type { IngestResult } from "@/features/library/types";
import { reportLibraryImport } from "@/features/library/events";
import { notify } from "@/shared/notifications/center";

const isImporting = ref(false);
watchActivity(isImporting);

export function useLibraryFileImport() {
  async function runImport(droppedPaths?: string[]) {
    if (!isTauri() || isImporting.value) return;
    // Hold the lock while the picker is open too, so repeated clicks cannot open
    // another picker or submit a second batch.
    isImporting.value = true;
    const id = operationId("library-import");
    const started = performance.now();
    try {
      const paths = droppedPaths
        ? await invoke<string[]>("readable_audio_files", { paths: droppedPaths })
        : await pickFiles();
      if (!paths || paths.length === 0) {
        logger.info("library", "file_import_cancelled", { operationId: id });
        return;
      }
      logger.info("library", "import_started", { operationId: id });
      const result = await invoke<IngestResult>("import_music_files", { paths, operationId: id });
      logger.info("library", "import_completed", {
        operationId: id,
        elapsedMs: Math.round(performance.now() - started),
        ...result,
      });
      if (!droppedPaths || result.added + result.updated > 0 || result.failed > 0)
        notify({
          type: result.failed > 0 ? "warning" : "success",
          message: result.failed
            ? t("导入完成，{count} 首失败（详情见日志）", { count: result.failed })
            : t("导入完成：新增 {added} 首，更新 {updated} 首", {
                added: result.added,
                updated: result.updated,
              }),
          key: "library-file-import",
        });
      reportLibraryImport(result);
    } catch (reason) {
      logger.error("library", "file_import_failed", reason, { operationId: id });
      notify({ type: "error", message: t("导入失败，请查看日志"), key: "library-file-import" });
    } finally {
      isImporting.value = false;
    }
  }

  async function pickFiles() {
    const extensions = await invoke<string[]>("supported_audio_extensions");
    return open({
      title: t("导入音频文件"),
      directory: false,
      multiple: true,
      filters: [{ name: t("支持的音频文件"), extensions }],
    });
  }

  return {
    isImporting,
    importMusicFiles: () => runImport(),
    importPaths: (paths: string[]) => runImport(paths),
  };
}

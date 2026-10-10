import { t } from "@/shared/i18n/locale";
import { logger, operationId } from "@/shared/logging/logger";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ref } from "vue";
import type { IngestResult } from "@/features/library/types";
import { reportLibraryImport } from "@/features/library/events";
import { notify } from "@/shared/notifications/center";

const isImporting = ref(false);

export function useLibraryFileImport() {
  async function importMusicFiles() {
    if (!isTauri() || isImporting.value) return;
    // Hold the lock while the picker is open too, so repeated clicks cannot open
    // another picker or submit a second batch.
    isImporting.value = true;
    const id = operationId("library-import");
    const started = performance.now();
    try {
      const extensions = await invoke<string[]>("supported_audio_extensions");
      const paths = await open({
        title: t("导入音频文件"),
        directory: false,
        multiple: true,
        filters: [{ name: t("支持的音频文件"), extensions }],
      });
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

  return { isImporting, importMusicFiles };
}

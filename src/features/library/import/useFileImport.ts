import { t } from "@/shared/i18n/locale";
import { logger, operationId } from "@/shared/logging/logger";
import { errorMessage, commandFailure } from "@/shared/notifications/error";
import { isTauri } from "@tauri-apps/api/core";
import { taskInvoke as invoke } from "@/features/tasks/commands";
import { open } from "@tauri-apps/plugin-dialog";
import { ref } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import type { IngestResult } from "@/features/library/types";
import { reportLibraryImport } from "@/features/library/events";
import { notify } from "@/shared/notifications/center";
import { tasks } from "@/shared/tasks/state";
import { writeQueue, TaskCancelled } from "@/features/tasks/queue";

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
    let submitted = false;
    try {
      if (droppedPaths) tasks.update({ key: id, message: t("导入音频文件"), completed: 0 });
      const paths = droppedPaths
        ? await invoke<string[]>("readable_audio_files", { paths: droppedPaths })
        : await pickFiles();
      if (!paths || paths.length === 0) {
        logger.debug("library", "file_import_cancelled", { operationId: id });
        return;
      }
      tasks.update({ key: id, message: t("导入音频文件"), completed: 0 });
      logger.debug("library", "import_started", { operationId: id });
      const operation = invoke<IngestResult>("import_music_files", { paths, operationId: id });
      submitted = true;
      isImporting.value = false;
      const result = await operation;
      logger.write(result.failed ? "warn" : "info", "library", "import_completed", {
        operationId: id,
        elapsedMs: Math.round(performance.now() - started),
        ...result,
      });
      if (
        !writeQueue.wasCancelled(id) &&
        (!droppedPaths || result.added + result.updated > 0 || result.failed > 0)
      )
        notify({
          type: result.failed > 0 ? "warning" : "success",
          message: result.failed
            ? t("导入完成，{count} 首失败", { count: result.failed })
            : t("导入完成：新增 {added} 首，更新 {updated} 首", {
                added: result.added,
                updated: result.updated,
              }),
          key: "library-file-import",
        });
      reportLibraryImport(result);
    } catch (reason) {
      if (reason instanceof TaskCancelled) return;
      const busy = commandFailure(reason)?.code === "write_busy";
      logger[busy ? "warn" : "error"]("library", "file_import_failed", reason, { operationId: id });
      notify({
        type: busy ? "warning" : "error",
        message: errorMessage(reason, t("导入失败")),
        key: "library-file-import",
      });
    } finally {
      tasks.finish(id);
      if (!submitted) isImporting.value = false;
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

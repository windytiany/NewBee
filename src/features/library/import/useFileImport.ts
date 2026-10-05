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
    try {
      const extensions = await invoke<string[]>("supported_audio_extensions");
      const paths = await open({
        title: "导入音频文件",
        directory: false,
        multiple: true,
        filters: [{ name: "支持的音频文件", extensions }],
      });
      if (!paths || paths.length === 0) return;
      const result = await invoke<IngestResult>("import_music_files", { paths });
      notify({
        type: result.failed > 0 ? "warning" : "success",
        message: `导入完成：新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}，读取失败 ${result.failed}`,
        key: "library-file-import",
      });
      reportLibraryImport(result);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      notify({ type: "error", message: `导入失败：${message}`, key: "library-file-import" });
    } finally {
      isImporting.value = false;
    }
  }

  return { isImporting, importMusicFiles };
}

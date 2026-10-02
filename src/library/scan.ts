import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";
import { notify } from "@/notification/center";
import { reportLibraryImport } from "@/library/changes";
import type { IngestResult } from "@/library/model";

const isScanning = ref(false);
const scanResult = ref<IngestResult | null>(null);
const scanError = ref("");

export function useLibraryScan() {
  async function scanMusicLibrary() {
    if (isScanning.value) return;

    isScanning.value = true;
    scanResult.value = null;
    scanError.value = "";
    try {
      scanResult.value = await invoke<IngestResult>("scan_music_library");
      const result = scanResult.value;
      notify({
        type: result.failed > 0 ? "warning" : "success",
        message: `扫描完成：新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}，读取失败 ${result.failed}`,
        key: "library-scan",
      });
      reportLibraryImport(result);
    } catch (error) {
      scanError.value = error instanceof Error ? error.message : String(error);
      notify({ type: "error", message: `扫描失败：${scanError.value}`, key: "library-scan" });
    } finally {
      isScanning.value = false;
    }
  }

  return { isScanning, scanResult, scanError, scanMusicLibrary };
}

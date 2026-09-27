import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";

export type LibraryScanResult = {
  added: number;
  updated: number;
  skipped: number;
  failed: number;
};

const isScanning = ref(false);
const scanResult = ref<LibraryScanResult | null>(null);
const scanError = ref("");

export function useLibraryScan() {
  async function scanMusicLibrary() {
    if (isScanning.value) return;

    isScanning.value = true;
    scanResult.value = null;
    scanError.value = "";
    try {
      scanResult.value = await invoke<LibraryScanResult>("scan_music_library");
    } catch (error) {
      scanError.value = error instanceof Error ? error.message : String(error);
    } finally {
      isScanning.value = false;
    }
  }

  return { isScanning, scanResult, scanError, scanMusicLibrary };
}

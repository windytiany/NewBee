import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";

export type LibraryScanResult = {
  added: number;
  updated: number;
  skipped: number;
  failed: number;
};

export const LIBRARY_SCAN_COMPLETED_EVENT = "newbee:library-scan-completed";

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
      globalThis.window.dispatchEvent(new Event(LIBRARY_SCAN_COMPLETED_EVENT));
    } catch (error) {
      scanError.value = error instanceof Error ? error.message : String(error);
    } finally {
      isScanning.value = false;
    }
  }

  return { isScanning, scanResult, scanError, scanMusicLibrary };
}

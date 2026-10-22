import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";
import { t } from "@/shared/i18n/locale";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { watchActivity } from "@/shared/lifecycle/activity";

export function useDirectories() {
  const folders = ref<string[]>([]);
  const isLoadingDirectories = ref(false);
  const directoryLoadFailed = ref(false);
  watchActivity(isLoadingDirectories);

  async function refreshDirectories() {
    if (isLoadingDirectories.value) return;
    isLoadingDirectories.value = true;
    directoryLoadFailed.value = false;
    try {
      folders.value = await invoke<string[]>("get_scan_folders");
    } catch (error) {
      directoryLoadFailed.value = true;
      logger.warn("library/scanning", "folders_read_failed", error);
      notify({ type: "error", message: t("读取扫描文件夹失败"), key: "library-scan-folders" });
    } finally {
      isLoadingDirectories.value = false;
    }
  }

  async function saveFolders(next: string[]) {
    if (isLoadingDirectories.value || directoryLoadFailed.value) return;
    const previous = folders.value;
    isLoadingDirectories.value = true;
    folders.value = next;
    try {
      folders.value = await invoke<string[]>("save_scan_folders", { folders: next });
    } catch (error) {
      folders.value = previous;
      logger.error("library/scanning", "folders_save_failed", error);
      notify({ type: "error", message: t("保存扫描文件夹失败"), key: "library-scan-folders" });
    } finally {
      isLoadingDirectories.value = false;
    }
  }
  return { folders, isLoadingDirectories, directoryLoadFailed, refreshDirectories, saveFolders };
}

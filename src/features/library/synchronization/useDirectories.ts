import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";
import { t } from "@/shared/i18n/locale";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { watchActivity } from "@/shared/lifecycle/activity";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { SynchronizationFolder } from "@/features/library/synchronization/types";

export function useDirectories() {
  const folders = ref<SynchronizationFolder[]>([]);
  const isLoadingDirectories = ref(false);
  const directoryLoadFailed = ref(false);
  watchActivity(isLoadingDirectories);
  let sequence = 0;

  async function refreshDirectories() {
    if (isLoadingDirectories.value) return;
    const request = ++sequence;
    isLoadingDirectories.value = true;
    directoryLoadFailed.value = false;
    try {
      const loaded = await invoke<SynchronizationFolder[]>("get_synchronization_folders");
      if (request === sequence) folders.value = loaded;
    } catch (error) {
      if (request !== sequence) return;
      directoryLoadFailed.value = true;
      logger.warn("library/synchronization", "folders_read_failed", error);
      notify({
        type: "error",
        message: t("读取同步文件夹失败"),
        key: "library-synchronization-folders",
      });
    } finally {
      if (request === sequence) isLoadingDirectories.value = false;
    }
  }

  async function saveFolders(next: SynchronizationFolder[]) {
    if (isLoadingDirectories.value || directoryLoadFailed.value) return;
    const previous = folders.value;
    const request = ++sequence;
    isLoadingDirectories.value = true;
    folders.value = next;
    try {
      const saved = await invoke<SynchronizationFolder[]>("save_synchronization_folders", {
        folders: next,
      });
      if (request !== sequence) return;
      folders.value = saved;
      globalThis.window.dispatchEvent(new globalThis.Event(SETTINGS_CHANGED_EVENT));
    } catch (error) {
      if (request !== sequence) return;
      folders.value = previous;
      logger.error("library/synchronization", "folders_save_failed", error);
      notify({
        type: "error",
        message: t("保存同步文件夹失败"),
        key: "library-synchronization-folders",
      });
    } finally {
      if (request === sequence) isLoadingDirectories.value = false;
    }
  }
  return { folders, isLoadingDirectories, directoryLoadFailed, refreshDirectories, saveFolders };
}

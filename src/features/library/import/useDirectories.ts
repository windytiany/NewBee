import { t } from "@/shared/i18n/locale";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ref } from "vue";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";

type LibraryDirectory = {
  id: number;
  path: string;
  displayPath: string;
};

export function useDirectories() {
  const directories = ref<LibraryDirectory[]>([]);
  const isLoadingDirectories = ref(false);
  const directoryLoadFailed = ref(false);

  async function refreshDirectories() {
    isLoadingDirectories.value = true;
    directoryLoadFailed.value = false;
    try {
      directories.value = await invoke<LibraryDirectory[]>("list_music_library_directories");
    } catch (error) {
      directoryLoadFailed.value = true;
      logger.warn("library.directories", "read_failed", error);
      notify({
        type: "error",
        message: t("读取已保存目录失败，请查看日志"),
        key: "library-directories",
      });
    } finally {
      isLoadingDirectories.value = false;
    }
  }

  async function addDirectory() {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: t("选择音乐库目录"),
      });
      if (typeof selectedPath !== "string") return;

      await invoke<boolean>("add_music_library_directory", { path: selectedPath });
      await refreshDirectories();
    } catch (error) {
      logger.warn("library.directories", "add_failed", error);
      notify({ type: "error", message: t("添加目录失败，请查看日志"), key: "library-directories" });
    }
  }

  async function removeDirectory(directory: LibraryDirectory) {
    try {
      await invoke("remove_music_library_directory", { id: directory.id });
      directories.value = directories.value.filter((saved) => saved.id !== directory.id);
    } catch (error) {
      logger.warn("library.directories", "remove_failed", error);
      notify({ type: "error", message: t("移除目录失败，请查看日志"), key: "library-directories" });
    }
  }

  return {
    directories,
    isLoadingDirectories,
    directoryLoadFailed,
    refreshDirectories,
    addDirectory,
    removeDirectory,
  };
}

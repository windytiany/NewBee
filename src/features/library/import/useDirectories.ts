import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ref } from "vue";
import { logger } from "@/shared/logging/logger";

type LibraryDirectory = {
  id: number;
  path: string;
  displayPath: string;
};

export function useDirectories() {
  const directoryError = ref("");
  const directories = ref<LibraryDirectory[]>([]);
  const isLoadingDirectories = ref(false);
  const directoryLoadFailed = ref(false);

  async function refreshDirectories() {
    isLoadingDirectories.value = true;
    directoryLoadFailed.value = false;
    directoryError.value = "";
    try {
      directories.value = await invoke<LibraryDirectory[]>("list_music_library_directories");
    } catch (error) {
      directoryLoadFailed.value = true;
      logger.warn("library.directories", "read_failed", error);
      directoryError.value = "读取已保存目录失败，请重试或查看日志";
    } finally {
      isLoadingDirectories.value = false;
    }
  }

  async function addDirectory() {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "选择音乐库目录",
      });
      if (typeof selectedPath !== "string") return;

      const added = await invoke<boolean>("add_music_library_directory", { path: selectedPath });
      await refreshDirectories();
      if (!added) directoryError.value = "目录已添加";
    } catch (error) {
      logger.warn("library.directories", "add_failed", error);
      directoryError.value = "添加目录失败，请重试或查看日志";
    }
  }

  async function removeDirectory(directory: LibraryDirectory) {
    try {
      await invoke("remove_music_library_directory", { id: directory.id });
      directories.value = directories.value.filter((saved) => saved.id !== directory.id);
    } catch (error) {
      logger.warn("library.directories", "remove_failed", error);
      directoryError.value = "移除目录失败，请重试或查看日志";
    }
  }

  return {
    directoryError,
    directories,
    isLoadingDirectories,
    directoryLoadFailed,
    refreshDirectories,
    addDirectory,
    removeDirectory,
  };
}

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ref } from "vue";
import { notify } from "@/shared/notifications/center";

type LibraryDirectory = {
  id: number;
  path: string;
  displayPath: string;
};

export function useDirectories() {
  const directories = ref<LibraryDirectory[]>([]);
  const isLoadingDirectories = ref(false);
  const directoryLoadFailed = ref(false);
  function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return typeof error === "string" ? error : "未知错误";
  }

  async function refreshDirectories() {
    isLoadingDirectories.value = true;
    directoryLoadFailed.value = false;
    try {
      directories.value = await invoke<LibraryDirectory[]>("list_music_library_directories");
    } catch (error) {
      directoryLoadFailed.value = true;
      notify({
        type: "error",
        message: `读取已保存目录失败：${errorMessage(error)}`,
        key: "scan-directories",
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
        title: "选择音乐库目录",
      });
      if (typeof selectedPath !== "string") return;

      const added = await invoke<boolean>("add_music_library_directory", { path: selectedPath });
      await refreshDirectories();
      if (!added) notify({ type: "info", message: "该目录已经保存。" });
    } catch (error) {
      notify({
        type: "error",
        message: `添加目录失败：${errorMessage(error)}`,
        key: "scan-directories",
      });
    }
  }

  async function removeDirectory(directory: LibraryDirectory) {
    try {
      await invoke("remove_music_library_directory", { id: directory.id });
      directories.value = directories.value.filter((saved) => saved.id !== directory.id);
    } catch (error) {
      notify({
        type: "error",
        message: `移除目录失败：${errorMessage(error)}`,
        key: "scan-directories",
      });
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

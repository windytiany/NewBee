<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="scan-dialog-title"
    class="bg-spotify-surface m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @click.self="closeDialog"
    @mousedown.stop
  >
    <section class="flex max-h-[85vh] flex-col">
      <header class="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div>
          <h2 id="scan-dialog-title" class="text-lg font-semibold">扫描文件夹</h2>
          <p class="text-spotify-muted mt-1 text-sm">管理音乐目录，然后扫描其中支持的音频文件。</p>
        </div>
        <button
          aria-label="关闭"
          class="focus-visible:outline-spotify-green text-spotify-muted rounded px-2 py-1 text-sm hover:bg-white/10 hover:text-white focus-visible:outline-2"
          type="button"
          @click="closeDialog"
        >
          关闭
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold">已保存目录</h3>
          <button
            class="focus-visible:outline-spotify-green rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!isTauriApp || isLoadingDirectories || isScanning"
            type="button"
            @click="addDirectory"
          >
            添加目录
          </button>
        </div>

        <ul v-if="directories.length > 0" class="mt-3 space-y-2">
          <li
            v-for="directory in directories"
            :key="directory.id"
            class="flex min-w-0 items-center gap-3 rounded-lg bg-white/5 px-3 py-2"
          >
            <span
              class="min-w-0 flex-1 truncate text-sm text-white/80"
              :title="directory.displayPath"
            >
              {{ directory.displayPath }}
            </span>
            <button
              class="focus-visible:outline-spotify-green text-spotify-muted shrink-0 rounded px-2 py-1 text-xs hover:bg-white/10 hover:text-white focus-visible:outline-2 disabled:opacity-50"
              :aria-label="`移除目录 ${directory.displayPath}`"
              :disabled="!isTauriApp || isScanning"
              type="button"
              @click="removeDirectory(directory)"
            >
              移除
            </button>
          </li>
        </ul>
        <p
          v-else-if="!isLoadingDirectories && !directoryLoadFailed"
          class="text-spotify-muted mt-3 rounded-lg bg-white/5 px-3 py-4 text-sm"
        >
          尚未添加目录。点击“添加目录”选择文件夹。
        </p>

        <p class="text-spotify-muted mt-3 text-xs">
          移除目录只会移除扫描配置，不会删除已入库歌曲。
        </p>
        <p v-if="!isTauriApp" class="text-spotify-muted mt-3 text-sm">
          请在桌面应用中选择和扫描目录。
        </p>
      </div>

      <footer class="border-t border-white/10 px-5 py-4">
        <p v-if="isScanning" class="text-spotify-green text-sm" role="status">
          正在扫描音乐文件，请稍候…
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            class="focus-visible:outline-spotify-green rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2"
            type="button"
            @click="closeDialog"
          >
            关闭
          </button>
          <button
            class="bg-spotify-green focus-visible:outline-spotify-green rounded-full px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!isTauriApp || isScanning || directories.length === 0"
            type="button"
            @click="scanMusicLibrary"
          >
            {{ isScanning ? "正在扫描…" : "开始扫描" }}
          </button>
        </div>
      </footer>
    </section>
  </dialog>
</template>

<script setup lang="ts">
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ref } from "vue";
import { useLibraryScan } from "@/library/scan";
import { notify } from "@/notification/center";

type LibraryDirectory = {
  id: number;
  path: string;
  displayPath: string;
};

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const isTauriApp = isTauri();
const directories = ref<LibraryDirectory[]>([]);
const isLoadingDirectories = ref(false);
const directoryLoadFailed = ref(false);
const { isScanning, scanMusicLibrary } = useLibraryScan();

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

function show() {
  if (!dialogElement.value?.open) dialogElement.value?.showModal();
  void refreshDirectories();
}

function closeDialog() {
  dialogElement.value?.close();
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
    const selectedPath = await open({ directory: true, multiple: false, title: "选择音乐库目录" });
    if (typeof selectedPath !== "string") return;

    const added = await invoke<boolean>("add_music_library_directory", { path: selectedPath });
    await refreshDirectories();
    notify({
      type: added ? "success" : "info",
      message: added ? "目录已保存。" : "该目录已经保存。",
    });
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
    notify({ type: "success", message: "目录已移除，已入库歌曲保留。" });
  } catch (error) {
    notify({
      type: "error",
      message: `移除目录失败：${errorMessage(error)}`,
      key: "scan-directories",
    });
  }
}

defineExpose({ show });
</script>

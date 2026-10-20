<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="scan-dialog-title"
    class="bg-app-surface m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @click.self="closeDialog"
    @mousedown.stop
  >
    <section class="flex max-h-[85vh] flex-col">
      <header class="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div class="flex items-center gap-2">
          <h2 id="scan-dialog-title" class="text-lg font-semibold">{{ t("扫描文件夹") }}</h2>
          <HelpDialog :label="t('扫描说明')">
            <p>{{ t("添加音乐目录后，扫描其中支持的音频文件。") }}</p>
            <p>{{ t("移除目录只会移除扫描配置，不会删除已入库歌曲。") }}</p>
          </HelpDialog>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold">{{ t("已保存目录") }}</h3>
          <button
            class="focus-visible:outline-app-accent rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!isTauriApp || isLoadingDirectories || isScanning"
            type="button"
            @click="addDirectory"
          >
            {{ t("添加目录") }}
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
              :title="formatPathForDisplay(directory.path)"
            >
              {{ formatPathForDisplay(directory.path) }}
            </span>
            <button
              class="focus-visible:outline-app-accent text-app-muted shrink-0 rounded px-2 py-1 text-xs hover:bg-white/10 hover:text-white focus-visible:outline-2 disabled:opacity-50"
              :aria-label="t('移除目录 {path}', { path: formatPathForDisplay(directory.path) })"
              :disabled="!isTauriApp || isScanning"
              type="button"
              @click="removeDirectory(directory)"
            >
              {{ t("移除") }}
            </button>
          </li>
        </ul>
        <p
          v-else-if="!isLoadingDirectories && !directoryLoadFailed"
          class="text-app-muted mt-3 rounded-lg bg-white/5 px-3 py-4 text-sm"
        >
          {{ t("无目录") }}
        </p>
      </div>

      <footer class="border-t border-white/10 px-5 py-4">
        <div class="flex justify-end gap-2">
          <button
            class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2"
            type="button"
            @click="closeDialog"
          >
            {{ t("取消") }}
          </button>
          <button
            class="bg-app-accent focus-visible:outline-app-accent text-app-on-accent rounded-full px-5 py-2 text-sm font-semibold transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="
              !isTauriApp || isScanning || isLoadingDirectories || directories.length === 0
            "
            type="button"
            @click="startScan"
          >
            {{ isScanning ? t("正在扫描…") : t("开始扫描") }}
          </button>
        </div>
      </footer>
    </section>
  </dialog>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { formatPathForDisplay } from "@/shared/filesystem/presentation";
import { isTauri } from "@tauri-apps/api/core";
import { ref } from "vue";
import { useLibraryScan } from "@/features/library/import/useScan";
import { useDirectories } from "@/features/library/import/useDirectories";
import HelpDialog from "@/shared/components/HelpDialog.vue";

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const isTauriApp = isTauri();
const {
  directories,
  isLoadingDirectories,
  directoryLoadFailed,
  refreshDirectories,
  addDirectory,
  removeDirectory,
} = useDirectories();
const { isScanning, scanMusicLibrary } = useLibraryScan();

function show() {
  if (!dialogElement.value?.open) dialogElement.value?.showModal();
  void refreshDirectories();
}

function closeDialog() {
  dialogElement.value?.close();
}

function startScan() {
  if (
    !isTauriApp ||
    isScanning.value ||
    isLoadingDirectories.value ||
    directories.value.length === 0
  )
    return;
  void scanMusicLibrary();
  closeDialog();
}

defineExpose({ show });
</script>

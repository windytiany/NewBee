<script setup lang="ts">
import { computed, ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { t } from "@/shared/i18n/locale";
import { useLibrarySynchronization } from "@/features/library/synchronization/useScan";
import { useDirectories } from "@/features/library/scanning/useDirectories";
import ScanFolders from "@/features/library/scanning/ScanFolders.vue";

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const isTauriApp = isTauri();
const { folders, isLoadingDirectories, directoryLoadFailed, refreshDirectories, saveFolders } =
  useDirectories();
const { isScanning, synchronizeLibrary } = useLibrarySynchronization();
const disabled = computed(
  () => !isTauriApp || isLoadingDirectories.value || directoryLoadFailed.value || isScanning.value,
);
function show() {
  if (!dialogElement.value?.open) dialogElement.value?.showModal();
  void refreshDirectories();
}
function closeDialog() {
  dialogElement.value?.close();
}
function startScan() {
  if (disabled.value || !folders.value.length) return;
  void synchronizeLibrary([...folders.value]);
  closeDialog();
}
defineExpose({ show });
</script>

<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="scan-dialog-title"
    class="bg-app-surface m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @click.self="closeDialog"
    @mousedown.stop
  >
    <section class="flex max-h-[85vh] flex-col">
      <header class="border-b border-white/10 px-5 py-4">
        <h2 id="scan-dialog-title" class="text-lg font-semibold">{{ t("扫描文件夹") }}</h2>
      </header>
      <fieldset :disabled="disabled" class="min-h-48 min-w-0 overflow-y-auto px-5 py-4">
        <legend class="sr-only">{{ t("扫描文件夹") }}</legend>
        <ScanFolders :model-value="folders" @update:model-value="saveFolders" />
      </fieldset>
      <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2"
          type="button"
          @click="closeDialog"
        >
          {{ t("关闭") }}
        </button>
        <button
          class="bg-app-accent focus-visible:outline-app-accent text-app-on-accent rounded-full px-5 py-2 text-sm font-semibold hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="disabled || !folders.length"
          type="button"
          @click="startScan"
        >
          {{ isScanning ? t("正在扫描…") : t("扫描") }}
        </button>
      </footer>
    </section>
  </dialog>
</template>

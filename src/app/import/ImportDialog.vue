<script setup lang="ts">
import { ref, watch } from "vue";
import { useLibraryFileImport } from "@/features/library/import/useFileImport";
import { useInboxImport } from "@/features/inbox/useImport";
import { t } from "@/shared/i18n/locale";
const dialog = ref<globalThis.HTMLDialogElement | null>(null);
const target = ref("library");
const source = ref("files");
const library = useLibraryFileImport();
const inbox = useInboxImport();
watch(target, () => {
  source.value = "files";
});
function show(inbox = false) {
  target.value = inbox ? "inbox" : "library";
  source.value = "files";
  dialog.value?.showModal();
}
async function submit() {
  dialog.value?.close();
  if (target.value === "inbox") await inbox.importFiles(source.value === "directory");
  else await library.importMusicFiles();
}
defineExpose({ show });
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="import-title"
    class="bg-app-surface m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-white/10 p-5 text-white shadow-2xl backdrop:bg-black/70"
    @mousedown.stop
  >
    <h2 id="import-title" class="text-lg font-semibold">{{ t("导入音频文件") }}</h2>
    <form class="mt-4 space-y-4" @submit.prevent="submit">
      <div class="space-y-2">
        <label for="import-target" class="block text-sm">{{ t("目标") }}</label
        ><select
          id="import-target"
          v-model="target"
          class="bg-app-surface focus-visible:outline-app-accent w-full rounded border border-white/15 px-3 py-2 text-sm focus-visible:outline-2"
        >
          <option value="library">{{ t("音乐库") }}</option>
          <option value="inbox">{{ t("Inbox") }}</option>
        </select>
      </div>
      <div v-if="target === 'inbox'" class="space-y-2">
        <label for="import-source" class="block text-sm">{{ t("来源") }}</label
        ><select
          id="import-source"
          v-model="source"
          class="bg-app-surface focus-visible:outline-app-accent w-full rounded border border-white/15 px-3 py-2 text-sm focus-visible:outline-2"
        >
          <option value="files">{{ t("文件") }}</option>
          <option value="directory">{{ t("文件夹") }}</option>
        </select>
      </div>
      <footer class="flex justify-end gap-2">
        <button
          type="button"
          class="focus-visible:outline-app-accent rounded px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2"
          @click="dialog?.close()"
        >
          {{ t("取消") }}</button
        ><button
          type="submit"
          :disabled="library.isImporting.value || inbox.pending.value"
          class="focus-visible:outline-app-accent bg-app-accent text-app-on-accent rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 disabled:opacity-50"
        >
          {{ t("导入") }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

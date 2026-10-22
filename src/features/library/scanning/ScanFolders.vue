<script setup lang="ts">
import { computed, ref } from "vue";
import { Minus, Plus } from "@lucide/vue";
import { open } from "@tauri-apps/plugin-dialog";
import { t } from "@/shared/i18n/locale";
import { formatPathForDisplay } from "@/shared/filesystem/presentation";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";

const folders = defineModel<string[]>({ required: true });
const selectedIndex = ref(-1);
const canRemove = computed(
  () => selectedIndex.value >= 0 && selectedIndex.value < folders.value.length,
);
async function add() {
  try {
    const path = await open({ directory: true, multiple: false });
    if (typeof path !== "string") return;
    const existing = folders.value.indexOf(path);
    if (existing >= 0) {
      selectedIndex.value = existing;
      return;
    }
    selectedIndex.value = folders.value.length;
    folders.value = [...folders.value, path];
  } catch (error) {
    logger.error("library/scanning", "choose_folder_failed", error);
    notify({ type: "error", message: t("选择文件夹失败"), key: "library-scan-folders" });
  }
}
function remove() {
  if (!canRemove.value) return;
  folders.value = folders.value.filter((_, index) => index !== selectedIndex.value);
  selectedIndex.value = -1;
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
    <div class="flex shrink-0 items-center justify-end gap-1">
      <button
        type="button"
        :aria-label="t('添加文件夹')"
        class="focus-visible:outline-app-accent text-app-muted flex size-7 items-center justify-center rounded-md hover:bg-white/10 hover:text-white focus-visible:outline-2"
        @click="add"
      >
        <Plus class="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        :aria-label="t('移除')"
        :disabled="!canRemove"
        class="focus-visible:outline-app-accent text-app-muted flex size-7 items-center justify-center rounded-md hover:bg-white/10 hover:text-white focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-40"
        @click="remove"
      >
        <Minus class="size-4" aria-hidden="true" />
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10">
      <table class="w-full table-fixed text-left text-sm">
        <thead class="sr-only">
          <tr>
            <th scope="col">{{ t("路径") }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/10">
          <tr
            v-for="(path, index) in folders"
            :key="path"
            :aria-selected="selectedIndex === index"
            tabindex="0"
            class="focus-visible:outline-app-accent cursor-default hover:bg-white/5 focus-visible:outline-2 focus-visible:-outline-offset-2"
            :class="{ 'bg-app-accent/10': selectedIndex === index }"
            @click="selectedIndex = index"
            @focusin="selectedIndex = index"
            @keydown.enter.self.prevent="selectedIndex = index"
            @keydown.space.self.prevent="selectedIndex = index"
          >
            <td class="truncate px-3 py-2 text-left">{{ formatPathForDisplay(path) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

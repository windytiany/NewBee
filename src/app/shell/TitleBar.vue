<template>
  <header
    data-focus-region
    class="bg-app-base fixed inset-x-0 top-0 z-50 grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3 text-white sm:px-6"
    @mousedown.left="startDragging"
  >
    <div class="justify-self-start">
      <AppMenu
        :can-import="isTauriApp"
        :is-importing="isImporting"
        :bindings="bindings"
        @select="onMenuSelect"
      />
      <ScanDialog ref="libraryScanDialog" />
      <ImportDialog ref="importDialog" />
      <PathRemappingDialog ref="pathRemappingDialog" />
      <SettingsDialog ref="settingsDialog" />
    </div>

    <PageTabs
      :active-page="props.activePage"
      @update:active-page="emit('update:activePage', $event)"
    />

    <div class="absolute inset-y-0 right-0 flex items-center gap-2">
      <TaskEntry />
      <WindowControls
        v-if="isTauriApp"
        :maximized="isMaximized"
        @minimize="minimizeWindow"
        @maximize="toggleMaximizeWindow"
        @close="closeWindow"
      />
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useWindow } from "@/app/shell/useWindow";
import PageTabs from "@/app/shell/PageTabs.vue";
import WindowControls from "@/app/shell/WindowControls.vue";
import TaskEntry from "@/shared/tasks/TaskEntry.vue";
import AppMenu from "@/app/shell/AppMenu.vue";
import ScanDialog from "@/features/library/scanning/ScanDialog.vue";
import ImportDialog from "@/app/import/ImportDialog.vue";
import { useInboxImport } from "@/features/inbox/useImport";
import { computed } from "vue";
import PathRemappingDialog from "@/features/remapping/PathRemappingDialog.vue";
import { useLibraryFileImport } from "@/features/library/import/useFileImport";
import SettingsDialog from "@/features/settings/SettingsDialog.vue";
import type { PageName } from "@/app/pages";
import type { AppMenuAction } from "@/app/shell/AppMenu.vue";

import type { ShortcutSettings } from "@/features/settings/types";
const props = defineProps<{ activePage: PageName; bindings?: ShortcutSettings }>();
const emit = defineEmits<{
  "update:activePage": [pageName: PageName];
  commands: [];
  shortcuts: [];
}>();
const {
  isTauriApp,
  isMaximized,
  startDragging,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
} = useWindow();
const libraryImport = useLibraryFileImport();
const inboxImport = useInboxImport();
const isImporting = computed(() => libraryImport.isImporting.value || inboxImport.pending.value);
const importDialog = ref<InstanceType<typeof ImportDialog> | null>(null);
const libraryScanDialog = ref<InstanceType<typeof ScanDialog> | null>(null);
const settingsDialog = ref<InstanceType<typeof SettingsDialog> | null>(null);
const pathRemappingDialog = ref<InstanceType<typeof PathRemappingDialog> | null>(null);

async function showSettings(category?: "advanced") {
  await settingsDialog.value?.show(category);
}
defineExpose({ showSettings });

async function onMenuSelect(action: AppMenuAction) {
  switch (action) {
    case "import":
      importDialog.value?.show(props.activePage === "Inbox");
      break;
    case "scan":
      libraryScanDialog.value?.show();
      break;
    case "remap":
      pathRemappingDialog.value?.show();
      break;
    case "settings":
      await showSettings();
      break;
    case "commands":
      emit("commands");
      break;
    case "shortcuts":
      emit("shortcuts");
      break;
  }
}
</script>

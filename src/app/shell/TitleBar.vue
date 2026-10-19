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
      <PathMigrationDialog ref="pathMigrationDialog" />
      <SettingsDialog ref="settingsDialog" />
    </div>

    <PageTabs
      :active-page="props.activePage"
      @update:active-page="emit('update:activePage', $event)"
    />

    <WindowControls
      v-if="isTauriApp"
      :maximized="isMaximized"
      @minimize="minimizeWindow"
      @maximize="toggleMaximizeWindow"
      @close="closeWindow"
    />
  </header>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useWindow } from "@/app/shell/useWindow";
import PageTabs from "@/app/shell/PageTabs.vue";
import WindowControls from "@/app/shell/WindowControls.vue";
import AppMenu from "@/app/shell/AppMenu.vue";
import ScanDialog from "@/features/library/import/ScanDialog.vue";
import ImportDialog from "@/features/import/ImportDialog.vue";
import { useInboxImport } from "@/features/inbox/import";
import { computed } from "vue";
import PathMigrationDialog from "@/features/library/paths/PathMigrationDialog.vue";
import { useLibraryFileImport } from "@/features/library/import/useFileImport";
import SettingsDialog from "@/features/settings/components/SettingsDialog.vue";
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
const pathMigrationDialog = ref<InstanceType<typeof PathMigrationDialog> | null>(null);

async function showSettings(category?: "about") {
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
    case "migrate":
      pathMigrationDialog.value?.show();
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

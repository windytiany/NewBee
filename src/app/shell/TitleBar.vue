<template>
  <header
    class="bg-app-base fixed inset-x-0 top-0 z-50 grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3 text-white sm:px-6"
    @mousedown.left="startDragging"
  >
    <div class="justify-self-start">
      <AppMenu :can-import="isTauriApp" :is-importing="isImporting" @select="onMenuSelect" />
      <ScanDialog ref="libraryScanDialog" />
      <ImportDialog ref="importDialog" />
      <PathMigrationDialog ref="pathMigrationDialog" />
      <SettingsDialog ref="settingsDialog" />
      <PlaybackStatisticsDialog ref="playbackStatisticsDialog" />
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
import PlaybackStatisticsDialog from "@/features/playback/statistics/PlaybackStatisticsDialog.vue";
import type { PageName } from "@/app/pages";
import type { AppMenuAction } from "@/app/shell/AppMenu.vue";

const props = defineProps<{ activePage: PageName }>();
const emit = defineEmits<{
  "update:activePage": [pageName: PageName];
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
const playbackStatisticsDialog = ref<InstanceType<typeof PlaybackStatisticsDialog> | null>(null);

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
    case "statistics":
      playbackStatisticsDialog.value?.show();
      break;
    case "settings":
      await settingsDialog.value?.show();
      break;
  }
}
</script>

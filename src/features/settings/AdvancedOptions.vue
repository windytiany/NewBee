<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import type { Settings } from "@/features/settings/types";
import BackupOptions from "@/features/backup/BackupOptions.vue";
import UpdatePanel from "@/shared/update/UpdatePanel.vue";
import type { useDiagnostics } from "@/features/settings/useDiagnostics";
const draft = defineModel<Settings>("draft", { required: true });
const props = defineProps<{
  disabled: boolean;
  isTauriApp: boolean;
  isBackingUp: boolean;
  diagnostics: ReturnType<typeof useDiagnostics>;
}>();
const { detailedLogging, isChangingLogging, changeLogging, openLogs } = props.diagnostics;
const emit = defineEmits<{ busy: [value: boolean] }>();
</script>

<template>
  <fieldset :disabled="disabled || isBackingUp" class="mb-6">
    <legend class="sr-only">{{ t("应用更新") }}</legend>
    <h4 class="mb-3 text-sm font-semibold">{{ t("应用更新") }}</h4>
    <label class="mb-4 flex cursor-pointer items-center gap-3 text-sm">
      <input
        v-model="draft.checkUpdatesOnStartup"
        type="checkbox"
        name="check-updates-on-startup"
        class="accent-app-accent"
      />
      {{ t("启动时自动检查更新") }}
    </label>
    <UpdatePanel />
  </fieldset>
  <fieldset :disabled="!isTauriApp || isBackingUp">
    <legend class="sr-only">{{ t("诊断日志") }}</legend>
    <h4 class="mb-3 text-sm font-semibold">{{ t("诊断") }}</h4>
    <button
      type="button"
      class="focus-visible:outline-app-accent rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20 focus-visible:outline-2 disabled:opacity-50"
      @click="openLogs"
    >
      {{ t("打开日志目录") }}
    </button>
    <label class="mt-5 flex items-center gap-3 text-sm">
      <input
        v-model="detailedLogging"
        :disabled="isChangingLogging"
        type="checkbox"
        class="accent-app-accent"
        @change="changeLogging"
      />
      {{ t("详细日志") }}
    </label>
  </fieldset>
  <div class="mt-6">
    <h4 class="mb-3 text-sm font-semibold">{{ t("备份") }}</h4>
    <BackupOptions @busy="emit('busy', $event)" />
  </div>
</template>

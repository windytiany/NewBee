<script setup lang="ts">
import { ref } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { captureInterfaceState } from "@/features/backup/interfaceState";
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";

const busy = ref(false);
const desktop = isTauri();
const emit = defineEmits<{ busy: [value: boolean] }>();
const filters = [{ name: "NewBee", extensions: ["newbee"] }];

async function run(operation: () => Promise<void>) {
  if (busy.value || !desktop) return;
  busy.value = true;
  emit("busy", true);
  try {
    await operation();
  } catch (error) {
    logger.error("backup", "operation_failed", error);
    const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    notify({
      type: "error",
      message: detail ? `${t("备份操作失败")}: ${detail}` : t("备份操作失败"),
      key: "backup",
    });
  } finally {
    busy.value = false;
    emit("busy", false);
  }
}

function exportBackup() {
  return run(async () => {
    const path = await save({ title: t("导出备份"), defaultPath: "NewBee.newbee", filters });
    if (!path) return;
    await invoke<void>("export_backup", { path, interface: captureInterfaceState() });
    notify({ type: "success", message: t("备份已导出"), key: "backup" });
  });
}

function importBackup() {
  return run(async () => {
    const path = await open({ title: t("导入备份"), multiple: false, directory: false, filters });
    if (typeof path !== "string") return;
    const token = await invoke<string>("inspect_backup", { path });
    const confirmed = await ask(
      t("将覆盖当前设置和媒体库，并重启应用。导入前会自动备份当前数据。"),
      {
        title: t("导入备份"),
        kind: "warning",
        okLabel: t("导入并重启"),
        cancelLabel: t("取消"),
      },
    );
    if (!confirmed) return;
    await invoke<void>("restore_backup", { token, interface: captureInterfaceState() });
  });
}

function openBackups() {
  return run(() => invoke<void>("open_backups_directory"));
}
</script>

<template>
  <fieldset :disabled="!desktop || busy" class="flex flex-wrap gap-3">
    <legend class="sr-only">{{ t("备份") }}</legend>
    <button
      type="button"
      class="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
      @click="exportBackup"
    >
      {{ t("导出备份") }}
    </button>
    <button
      type="button"
      class="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
      @click="importBackup"
    >
      {{ t("导入备份") }}
    </button>
    <button
      type="button"
      class="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20 disabled:opacity-50"
      @click="openBackups"
    >
      {{ t("打开备份目录") }}
    </button>
  </fieldset>
  <p v-if="busy" role="status" class="text-app-muted mt-4 text-sm">{{ t("正在处理…") }}</p>
</template>

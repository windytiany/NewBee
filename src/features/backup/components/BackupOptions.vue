<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { captureInterfaceState } from "@/features/backup/interface";
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";

const busy = ref(false);
watchActivity(busy);
const backupCurrent = ref(true);
const confirmationDialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
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
    backupCurrent.value = true;
    const dialog = confirmationDialog.value;
    if (!dialog) return;
    const confirmed = await new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve;
      dialog.showModal();
    });
    if (!confirmed) return;
    await invoke<void>("restore_backup", {
      token,
      interface: captureInterfaceState(),
      backupCurrent: backupCurrent.value,
    });
  });
}

function finishConfirmation(confirmed: boolean) {
  const resolve = resolveConfirmation;
  resolveConfirmation = undefined;
  confirmationDialog.value?.close();
  resolve?.(confirmed);
}

onBeforeUnmount(() => finishConfirmation(false));

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
  <dialog
    ref="confirmationDialog"
    aria-labelledby="backup-import-title"
    aria-describedby="backup-import-description"
    class="bg-app-surface m-auto w-[min(30rem,calc(100vw-2rem))] max-w-none rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @click.self="finishConfirmation(false)"
    @cancel.prevent="finishConfirmation(false)"
  >
    <header class="border-b border-white/10 px-5 py-4">
      <h2 id="backup-import-title" class="text-lg font-semibold">{{ t("导入备份") }}</h2>
    </header>
    <div class="space-y-4 px-5 py-4">
      <p id="backup-import-description" class="text-app-muted text-sm">
        {{ t("将覆盖当前设置和媒体库，并重启应用。") }}
      </p>
      <label class="flex items-center gap-2 text-sm">
        <input v-model="backupCurrent" type="checkbox" class="accent-app-accent" />
        {{ t("备份当前状态") }}
      </label>
    </div>
    <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
      <button
        type="button"
        class="rounded-lg px-4 py-2 text-sm hover:bg-white/10"
        autofocus
        @click="finishConfirmation(false)"
      >
        {{ t("取消") }}
      </button>
      <button
        type="button"
        class="bg-app-accent rounded-lg px-4 py-2 text-sm text-white"
        @click="finishConfirmation(true)"
      >
        {{ t("导入并重启") }}
      </button>
    </footer>
  </dialog>
</template>

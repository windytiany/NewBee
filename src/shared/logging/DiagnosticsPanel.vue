<script setup lang="ts">
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { t } from "@/shared/i18n/locale";
import { notify } from "@/shared/notifications/center";
import { errorMessage } from "@/shared/notifications/error";
import { logger } from "@/shared/logging/logger";

const level = ref("WARN");
const module = ref("");
const operationId = ref("");
const since = ref("");
const until = ref("");
const allSessions = ref(false);
const includeContext = ref(false);
const anonymizePaths = ref(true);
const exporting = ref(false);

async function exportDiagnostics() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const destination = await save({
      title: t("导出诊断"),
      defaultPath: "newbee.jsonl",
      filters: [{ name: "JSONL", extensions: ["jsonl"] }],
    });
    if (!destination) return;
    const result = await invoke<{ records: number; omitted: number }>("export_diagnostics", {
      destination,
      options: {
        level: level.value,
        module: module.value.trim() || null,
        operationId: operationId.value.trim() || null,
        since: since.value ? new Date(since.value).getTime() : null,
        until: until.value ? new Date(until.value).getTime() : null,
        allSessions: allSessions.value,
        includeContext: includeContext.value,
        anonymizePaths: anonymizePaths.value,
      },
    });
    notify({
      type: "success",
      message: t(result.records ? "诊断已导出" : "未找到匹配记录"),
      key: "diagnostic-export",
    });
  } catch (reason) {
    logger.error("logging", "export_failed", reason);
    notify({
      type: "error",
      message: errorMessage(reason, t("导出诊断失败")),
      key: "diagnostic-export",
    });
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <fieldset :disabled="exporting" class="mt-5 space-y-3">
    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1 text-sm">
        {{ t("最低等级") }}
        <select v-model="level" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <option value="ERROR">ERROR</option>
          <option value="WARN">WARN</option>
          <option value="INFO">INFO</option>
          <option value="DEBUG">DEBUG</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t("日志模块") }}
        <input
          v-model="module"
          type="text"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
        />
      </label>
      <label class="col-span-2 flex flex-col gap-1 text-sm">
        {{ t("操作 ID") }}
        <input
          v-model="operationId"
          type="text"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t("开始时间") }}
        <input
          v-model="since"
          type="datetime-local"
          class="min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t("结束时间") }}
        <input
          v-model="until"
          type="datetime-local"
          class="min-w-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
        />
      </label>
    </div>
    <div class="flex flex-wrap gap-4 text-sm">
      <label class="flex items-center gap-2"
        ><input v-model="allSessions" type="checkbox" class="accent-app-accent" />{{
          t("全部会话")
        }}</label
      >
      <label class="flex items-center gap-2"
        ><input v-model="includeContext" type="checkbox" class="accent-app-accent" />{{
          t("关联上下文")
        }}</label
      >
      <label class="flex items-center gap-2"
        ><input v-model="anonymizePaths" type="checkbox" class="accent-app-accent" />{{
          t("隐藏路径")
        }}</label
      >
    </div>
    <button
      type="button"
      class="focus-visible:outline-app-accent rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20 focus-visible:outline-2 disabled:opacity-50"
      @click="exportDiagnostics"
    >
      {{ t("导出诊断") }}
    </button>
  </fieldset>
</template>

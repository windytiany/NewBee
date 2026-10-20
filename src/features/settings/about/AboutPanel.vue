<script setup lang="ts">
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import config from "../../../../src-tauri/tauri.conf.json";
import logo from "../../../../src-tauri/icons/128x128.png";
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";

const repository = "https://github.com/windytiany/NewBee";

async function openRepository(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (!isTauri()) return;
  event.preventDefault();
  try {
    await openUrl(repository);
  } catch (reason) {
    logger.error("settings", "open_repository_failed", reason);
    notify({ type: "error", message: t("打开仓库失败"), key: "settings-repository" });
  }
}
</script>

<template>
  <div class="flex flex-col items-center gap-5 py-6 text-center">
    <img :src="logo" alt="NewBee" class="size-24" />
    <p class="text-xl font-semibold">NewBee</p>
    <dl class="grid grid-cols-[auto_auto] gap-x-4 gap-y-3 text-left text-sm">
      <dt class="text-app-muted">{{ t("版本") }}</dt>
      <dd>{{ config.version }}</dd>
      <dt class="text-app-muted">{{ t("作者") }}</dt>
      <dd>windytiany</dd>
      <dt class="text-app-muted">{{ t("仓库") }}</dt>
      <dd class="min-w-0">
        <a
          :href="repository"
          target="_blank"
          rel="noopener noreferrer"
          class="text-app-accent focus-visible:outline-app-accent break-all hover:underline focus-visible:outline-2"
          @click="openRepository"
          >{{ repository }}</a
        >
      </dd>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { checkForUpdates, getUpdater } from "@/shared/update/runtime";
import { t } from "@/shared/i18n/locale";

const updater = getUpdater();
const { busy, phase } = updater;
</script>

<template>
  <button
    v-if="updater.supported"
    type="button"
    :disabled="busy"
    class="focus-visible:outline-app-accent rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20 focus-visible:outline-2 disabled:opacity-50"
    @click="checkForUpdates()"
  >
    {{ phase === "checking" ? t("正在检查更新…") : t("检查更新") }}
  </button>
</template>

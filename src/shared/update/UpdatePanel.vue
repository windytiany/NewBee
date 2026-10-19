<script setup lang="ts">
import { computed } from "vue";
import { getUpdater } from "@/shared/update/runtime";
import { t } from "@/shared/i18n/locale";

const updater = getUpdater();
const { phase, version, error, downloaded, total, busy } = updater;
const status = computed(() => {
  switch (phase.value) {
    case "checking":
      return t("正在检查更新…");
    case "latest":
      return t("已是最新版本");
    case "available":
      return t("发现新版本 {version}", { version: version.value });
    case "downloading":
      return t("正在下载更新…");
    case "ready":
      return t("更新已就绪");
    case "installing":
      return t("正在安装更新…");
    default:
      return "";
  }
});
</script>

<template>
  <section v-if="updater.supported" class="w-full max-w-sm space-y-3" :aria-label="t('应用更新')">
    <p v-if="status" role="status" class="text-app-muted text-sm">{{ status }}</p>
    <p v-if="error" role="alert" class="text-sm text-red-400">{{ t(error) }}</p>
    <progress
      v-if="phase === 'downloading'"
      :aria-label="t('下载进度')"
      :value="total === undefined ? undefined : downloaded"
      :max="Math.max(1, total ?? 1)"
      class="accent-app-accent w-full"
    ></progress>
    <div class="flex justify-center gap-3">
      <button
        v-if="phase !== 'ready' && phase !== 'installing'"
        type="button"
        :disabled="busy"
        class="bg-app-interactive focus-visible:outline-app-accent rounded-lg px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="updater.check()"
      >
        {{ t("检查更新") }}
      </button>
      <button
        v-if="phase === 'available'"
        type="button"
        class="bg-app-accent focus-visible:outline-app-accent rounded-lg px-4 py-2 text-sm text-black hover:brightness-110 focus-visible:outline-2"
        @click="updater.download()"
      >
        {{ t("更新") }}
      </button>
      <button
        v-if="phase === 'ready' || phase === 'installing'"
        type="button"
        :disabled="busy"
        class="bg-app-accent focus-visible:outline-app-accent rounded-lg px-4 py-2 text-sm text-black hover:brightness-110 focus-visible:outline-2 disabled:opacity-50"
        @click="updater.install()"
      >
        {{ t("重启并更新") }}
      </button>
    </div>
  </section>
</template>

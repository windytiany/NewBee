<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { getUpdater } from "@/shared/update/runtime";
import { t } from "@/shared/i18n/locale";

const updater = getUpdater();
const { dialogOpen, phase, version, error, downloaded, total, busy } = updater;
const dialog = ref<globalThis.HTMLDialogElement | null>(null);
const status = computed(() => {
  if (phase.value === "downloading") return t("正在下载更新…");
  if (phase.value === "installing") return t("正在安装更新…");
  if (phase.value === "ready") return t("更新已就绪");
  return t("发现新版本 {version}，是否更新？", { version: version.value });
});
const percentage = computed(() =>
  total.value ? Math.min(100, Math.floor((downloaded.value / total.value) * 100)) : undefined,
);

watch(
  dialogOpen,
  async (open) => {
    await nextTick();
    if (open && !dialog.value?.open) dialog.value?.showModal();
    else if (!open && dialog.value?.open) dialog.value.close();
  },
  { immediate: true },
);
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="update-title"
    aria-describedby="update-status"
    class="bg-app-surface m-auto w-[min(30rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel.prevent="updater.dismiss()"
    @click.self="updater.dismiss()"
    @mousedown.stop
  >
    <header class="border-b border-white/10 px-5 py-4">
      <h2 id="update-title" class="text-lg font-semibold">{{ t("应用更新") }}</h2>
    </header>
    <div class="space-y-3 px-5 py-4">
      <p id="update-status" role="status" class="text-app-muted text-sm">{{ status }}</p>
      <template v-if="phase === 'downloading'">
        <progress
          :aria-label="t('下载进度')"
          :value="total === undefined ? undefined : downloaded"
          :max="Math.max(1, total ?? 1)"
          class="accent-app-accent w-full"
        ></progress>
        <p v-if="percentage !== undefined" class="text-app-muted text-sm">{{ percentage }}%</p>
      </template>
      <p v-if="error" role="alert" class="text-sm text-red-400">{{ t(error) }}</p>
    </div>
    <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
      <button
        type="button"
        autofocus
        :disabled="busy"
        class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="updater.dismiss()"
      >
        {{ t("取消") }}
      </button>
      <button
        type="button"
        :disabled="busy"
        class="bg-app-accent focus-visible:outline-app-accent text-app-on-accent rounded-full px-5 py-2 text-sm font-semibold hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
        @click="updater.update()"
      >
        {{ error ? t("重试") : t("更新") }}
      </button>
    </footer>
  </dialog>
</template>

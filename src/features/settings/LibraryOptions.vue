<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import type { Settings } from "@/features/settings/types";
import SynchronizationOptions from "@/features/library/synchronization/SynchronizationOptions.vue";
const draft = defineModel<Settings>("draft", { required: true });
defineProps<{ disabled: boolean }>();
</script>

<template>
  <fieldset :disabled="disabled">
    <legend class="sr-only">{{ t("媒体库") }}</legend>
    <div class="flex min-h-48 min-w-0 flex-col">
      <SynchronizationOptions v-model="draft.synchronizationFolders">
        <template #heading>
          <h4 class="mr-auto self-start text-sm font-semibold">{{ t("同步文件夹") }}</h4>
        </template>
      </SynchronizationOptions>
    </div>
    <label class="mt-5 flex items-center gap-3 text-sm">
      <input
        v-model="draft.scanReplayGain"
        name="scan-replay-gain"
        type="checkbox"
        class="accent-app-accent"
      />
      {{ t("扫描时补齐 ReplayGain 标签") }}
    </label>
    <h4 class="mt-5 mb-3 text-sm font-semibold">{{ t("专辑排序") }}</h4>
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="text-app-muted flex flex-col gap-2 text-sm">
        {{ t("排序依据") }}
        <select
          v-model="draft.albumSortBy"
          class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 text-white focus-visible:outline-2"
        >
          <option value="name">{{ t("专辑名称") }}</option>
          <option value="year">{{ t("发布日期") }}</option>
        </select>
      </label>
      <label class="text-app-muted flex flex-col gap-2 text-sm">
        {{ t("排序方向") }}
        <select
          v-model="draft.albumSortOrder"
          class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 text-white focus-visible:outline-2"
        >
          <option value="ascending">{{ t("升序") }}</option>
          <option value="descending">{{ t("降序") }}</option>
        </select>
      </label>
    </div>
    <label class="mt-5 flex items-center gap-3 text-sm">
      <input v-model="draft.showPlaybackStatistics" type="checkbox" class="accent-app-accent" />
      {{ t("显示播放统计") }}
    </label>
  </fieldset>
</template>

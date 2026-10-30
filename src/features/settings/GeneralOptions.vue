<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import type { Settings } from "@/features/settings/types";
const draft = defineModel<Settings>("draft", { required: true });
defineProps<{ disabled: boolean }>();
</script>

<template>
  <fieldset :disabled="disabled">
    <legend class="sr-only">{{ t("关闭窗口时的行为") }}</legend>
    <label class="mb-5 flex flex-col gap-2 text-sm font-semibold">
      {{ t("语言") }}
      <select
        v-model="draft.locale"
        name="locale"
        class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
      >
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </select>
    </label>
    <label class="mb-5 flex cursor-pointer items-center gap-3 text-sm">
      <input
        v-model="draft.startupSplash"
        name="startup-splash"
        type="checkbox"
        class="accent-app-accent"
      />
      <span>{{ t("启动开屏") }}</span>
    </label>
    <p id="close-behavior-description" class="mb-3 text-sm font-semibold">
      {{ t("关闭窗口时") }}
    </p>
    <label key="tray" class="flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3">
      <input
        v-model="draft.closeBehavior"
        aria-describedby="close-behavior-description"
        class="accent-app-accent mt-1"
        name="close-behavior"
        type="radio"
        value="tray"
      />
      <span class="text-sm">{{ t("缩小到托盘") }}</span>
    </label>
    <label
      key="lightweight"
      class="mt-2 ml-9 flex items-start gap-3 py-2 pr-3 text-sm"
      :class="draft.closeBehavior === 'tray' ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'"
    >
      <input
        v-model="draft.lightweightOnClose"
        :disabled="draft.closeBehavior !== 'tray'"
        type="checkbox"
        name="lightweight-on-close"
        class="accent-app-accent mt-1"
      />
      <span>{{ t("关闭到托盘时进入轻量模式") }}</span>
    </label>
    <label
      key="exit"
      class="mt-2 flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3"
    >
      <input
        v-model="draft.closeBehavior"
        aria-describedby="close-behavior-description"
        class="accent-app-accent mt-1"
        name="close-behavior"
        type="radio"
        value="exit"
      />
      <span class="text-sm">{{ t("直接退出") }}</span>
    </label>
  </fieldset>
</template>

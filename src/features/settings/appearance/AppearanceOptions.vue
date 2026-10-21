<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/shared/i18n/locale";
import type { Settings } from "@/features/settings/types";
import { ACCENT_COLORS, normalizeAccentColor } from "@/features/settings/appearance/accent";
const draft = defineModel<Settings>("draft", { required: true });
defineProps<{ disabled: boolean }>();
const normalizedAccentColor = computed(() => normalizeAccentColor(draft.value.accentColor));
</script>

<template>
  <fieldset :disabled="disabled">
    <legend class="sr-only">{{ t("外观") }}</legend>
    <label class="mb-5 flex flex-col gap-2 text-sm font-semibold">
      {{ t("主题") }}
      <select
        v-model="draft.themeMode"
        name="theme-mode"
        class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
      >
        <option value="system">{{ t("跟随系统") }}</option>
        <option value="light">{{ t("亮色") }}</option>
        <option value="dark">{{ t("暗色") }}</option>
      </select>
    </label>
    <label class="mb-5 flex flex-col gap-2 text-sm font-semibold">
      {{ t("布局") }}
      <select
        v-model="draft.layoutDensity"
        name="layout-density"
        class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
      >
        <option value="regular">{{ t("常规布局") }}</option>
        <option value="compact">{{ t("紧凑布局") }}</option>
      </select>
    </label>
    <div role="group" aria-labelledby="accent-color-label" class="space-y-3">
      <h4 id="accent-color-label" class="text-sm font-semibold">{{ t("主题色") }}</h4>
      <div class="flex flex-wrap gap-3">
        <button
          v-for="color in ACCENT_COLORS"
          :key="color.value"
          type="button"
          :aria-label="t(`${color.label}色`)"
          :aria-pressed="normalizedAccentColor === color.value"
          :style="{ backgroundColor: `light-dark(${color.light}, ${color.value})` }"
          class="focus-visible:outline-app-accent size-8 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-offset-4"
          :class="normalizedAccentColor === color.value ? 'border-white' : 'border-transparent'"
          @click="draft.accentColor = color.value"
        ></button>
      </div>
      <div class="flex items-center gap-3">
        <input
          v-model="draft.accentColor"
          type="color"
          name="accent-color-picker"
          :aria-label="t('选择自定义主题色')"
          class="focus-visible:outline-app-accent h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent focus-visible:outline-2"
        />
        <input
          v-model="draft.accentColor"
          type="text"
          autocomplete="off"
          name="accent-color"
          :aria-label="t('自定义主题色')"
          pattern="#[0-9a-fA-F]{6}"
          maxlength="7"
          required
          spellcheck="false"
          class="bg-app-interactive focus-visible:outline-app-accent w-28 rounded-lg border border-white/10 px-3 py-2 text-sm text-white focus-visible:outline-2"
        />
      </div>
    </div>
    <div role="group" aria-labelledby="motion-label" class="mt-5 space-y-3">
      <h4 id="motion-label" class="text-sm font-semibold">{{ t("动态效果") }}</h4>
      <label class="flex cursor-pointer items-start gap-3">
        <input
          v-model="draft.reducedMotion"
          class="accent-app-accent mt-1"
          name="reduced-motion"
          type="checkbox"
        />
        <span class="text-sm font-semibold">{{ t("减少动态效果") }}</span>
      </label>
    </div>
    <div role="group" aria-labelledby="cover-background-label" class="mt-5 space-y-3">
      <h4 id="cover-background-label" class="text-sm font-semibold">{{ t("封面背景") }}</h4>
      <label class="flex cursor-pointer items-start gap-3">
        <input
          v-model="draft.albumCoverBackground"
          class="accent-app-accent mt-1"
          name="album-cover-background"
          type="checkbox"
        />
        <span class="text-sm font-semibold">{{ t("专辑详情封面背景") }}</span>
      </label>
      <label class="flex cursor-pointer items-start gap-3">
        <input
          v-model="draft.playingCoverBackground"
          class="accent-app-accent mt-1"
          name="playing-cover-background"
          type="checkbox"
        />
        <span class="text-sm font-semibold">{{ t("播放页封面背景") }}</span>
      </label>
    </div>
  </fieldset>
</template>

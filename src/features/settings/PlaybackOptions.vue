<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/shared/i18n/locale";
import type { Settings } from "@/features/settings/types";
import { locale } from "@/shared/i18n/locale";
import { RotateCcw } from "@lucide/vue";
const draft = defineModel<Settings>("draft", { required: true });
defineProps<{ disabled: boolean }>();
const playbackLabel = computed(() => (locale.value === "en" ? "Playback" : "播放"));
</script>

<template>
  <fieldset :disabled="disabled">
    <legend class="sr-only">{{ playbackLabel }}</legend>
    <h4 id="playback-loudness-label" class="mb-3 text-sm font-semibold">{{ t("响度均衡") }}</h4>
    <label class="flex items-center gap-3 text-sm">
      <input
        v-model="draft.replayGain"
        name="replay-gain"
        type="checkbox"
        class="accent-app-accent"
      />
      {{ t("启用响度均衡") }}
    </label>
    <div class="mt-3 ml-7 flex items-center gap-3 text-sm">
      <label for="replay-gain-preamp">{{ t("前级增益") }}</label>
      <input
        id="replay-gain-preamp"
        v-model.number="draft.replayGainPreamp"
        name="replay-gain-preamp"
        type="number"
        min="-20"
        max="20"
        step="0.5"
        required
        :disabled="!draft.replayGain"
        class="bg-app-interactive focus-visible:outline-app-accent w-24 rounded-lg border border-white/10 px-3 py-2 text-white focus-visible:outline-2 disabled:opacity-50"
      />
      <button
        type="button"
        :aria-label="t('恢复默认')"
        :disabled="!draft.replayGain"
        class="focus-visible:outline-app-accent rounded-lg p-2 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="draft.replayGainPreamp = 0"
      >
        <RotateCcw :size="16" aria-hidden="true" />
      </button>
    </div>
    <h4 class="mt-5 mb-3 text-sm font-semibold">{{ t("效果") }}</h4>
    <div class="space-y-3">
      <label class="flex items-center gap-3 text-sm">
        <input
          v-model="draft.playbackFadeIn"
          name="playback-fade-in"
          type="checkbox"
          class="accent-app-accent"
        />
        {{ t("播放淡入") }}
      </label>
      <label class="flex items-center gap-3 text-sm">
        <input
          v-model="draft.playbackFadeOut"
          name="playback-fade-out"
          type="checkbox"
          class="accent-app-accent"
        />
        {{ t("暂停淡出") }}
      </label>
    </div>
  </fieldset>
</template>

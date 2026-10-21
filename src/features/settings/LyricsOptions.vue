<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/shared/i18n/locale";
import type { Settings } from "@/features/settings/types";
const draft = defineModel<Settings>("draft", { required: true });
defineProps<{ disabled: boolean }>();
const neteaseEnabled = computed({
  get: () => draft.value.lyricsProviders.includes("netease"),
  set: (enabled: boolean) => {
    draft.value.lyricsProviders = enabled ? ["netease"] : [];
  },
});
</script>

<template>
  <fieldset :disabled="disabled" aria-labelledby="netease-lyrics-label">
    <legend class="sr-only">{{ t("网易云音乐") }}</legend>
    <h4 id="netease-lyrics-label" class="mb-3 text-sm font-semibold">
      {{ t("网易云音乐") }}
    </h4>
    <div>
      <label class="flex cursor-pointer items-start gap-3 text-sm">
        <input
          v-model="neteaseEnabled"
          type="checkbox"
          name="netease-lyrics"
          class="accent-app-accent mt-1"
        />
        <span class="text-sm">{{ t("启用") }}</span>
      </label>
      <div class="mt-3">
        <select
          v-model="draft.neteaseLyricsMode"
          name="netease-lyrics-mode"
          :aria-label="t('歌词内容')"
          class="bg-app-interactive focus-visible:outline-app-accent w-full min-w-0 rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
        >
          <option value="original">{{ t("原始歌词") }}</option>
          <option value="translated">{{ t("翻译歌词") }}</option>
          <option value="bilingual">{{ t("双语歌词") }}</option>
        </select>
      </div>
    </div>
  </fieldset>
</template>

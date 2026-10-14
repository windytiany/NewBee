<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import type { EditorTrack } from "@/features/metadata/types";
import LyricsSearch from "@/features/lyrics/download/LyricsSearch.vue";

const props = defineProps<{
  track: EditorTrack;
  modelValue: string;
  originalValue?: string;
  writable: boolean;
  disabled: boolean;
  form: string;
  inputId: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string]; mark: [] }>();
function edit(event: InstanceType<typeof globalThis.Event>) {
  emit(
    "update:modelValue",
    (event.target as InstanceType<typeof globalThis.HTMLTextAreaElement>).value,
  );
}
</script>

<template>
  <textarea
    :id="inputId"
    autocomplete="off"
    :form="form"
    :aria-label="t('内嵌歌词')"
    :value="props.modelValue"
    :readonly="!writable"
    :disabled="disabled"
    class="focus-visible:outline-app-accent min-h-80 w-full resize-y rounded border border-white/15 bg-black/20 px-3 py-2 font-mono text-sm read-only:text-white/50 focus-visible:outline-2 disabled:opacity-50"
    spellcheck="false"
    @input="edit"
  />
  <div class="mt-3 flex items-center justify-between gap-3">
    <slot name="mark" />
    <div class="ml-auto shrink-0">
      <LyricsSearch
        :track="track"
        :modified="modelValue !== originalValue"
        :disabled="!writable || disabled"
        @apply="emit('update:modelValue', $event)"
        @mark="emit('mark')"
      />
    </div>
  </div>
</template>

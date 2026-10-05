<script setup lang="ts">
import type { TrackDetails } from "@/features/library/types";
import LyricsSearch from "@/features/lyrics/components/LyricsSearch.vue";

const props = defineProps<{
  track: TrackDetails;
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
  <LyricsSearch
    :track="track"
    :modified="modelValue !== originalValue"
    :disabled="!writable || disabled"
    @apply="emit('update:modelValue', $event)"
    @mark="emit('mark')"
  />
  <textarea
    :id="inputId"
    :form="form"
    aria-label="内嵌歌词"
    :value="props.modelValue"
    :readonly="!writable"
    :disabled="disabled"
    placeholder="无歌词"
    class="focus-visible:outline-app-accent min-h-80 w-full resize-y rounded border border-white/15 bg-black/20 px-3 py-2 font-mono text-sm read-only:text-white/50 focus-visible:outline-2 disabled:opacity-50"
    spellcheck="false"
    @input="edit"
  />
</template>

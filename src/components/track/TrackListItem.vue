<template>
  <li :aria-current="isCurrentTrack ? 'true' : undefined">
    <button
      class="focus-visible:outline-spotify-green flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors focus-visible:outline-2"
      :class="
        isSelected
          ? 'bg-white/10 ring-1 ring-white/10 ring-inset'
          : isFocused
            ? 'bg-spotify-interactive'
            : 'hover:bg-white/5'
      "
      :aria-pressed="isSelected ? true : undefined"
      type="button"
      @click="emit('select')"
    >
      <span
        aria-hidden="true"
        class="grid size-10 shrink-0 place-items-center rounded-sm bg-linear-to-br from-[#293b70] via-[#222b50] to-[#171727] text-sky-200/80"
      >
        <Disc3 class="size-5" />
      </span>
      <AudioLines
        v-if="isCurrentTrack"
        aria-hidden="true"
        class="text-spotify-green size-4 shrink-0"
      />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          class="truncate text-sm font-medium"
          :class="isCurrentTrack ? 'text-spotify-green' : 'text-white'"
        >
          {{ title }}
        </span>
        <span class="text-spotify-muted truncate text-xs">{{ album }}</span>
      </span>
      <span class="text-spotify-muted shrink-0 pl-1 text-xs tabular-nums">{{ duration }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { AudioLines, Disc3 } from "@lucide/vue";

withDefaults(
  defineProps<{
    title: string;
    album: string;
    duration: string;
    isCurrentTrack?: boolean;
    isSelected?: boolean;
    isFocused: boolean;
  }>(),
  {
    isCurrentTrack: false,
    isSelected: false,
  },
);

const emit = defineEmits<{
  select: [];
}>();
</script>

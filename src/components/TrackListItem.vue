<template>
  <li :aria-current="isCurrentTrack ? 'true' : undefined">
    <button
      class="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-spotify-green"
      :class="isFocused ? 'bg-spotify-interactive' : 'hover:bg-white/5'"
      type="button"
      @click="emit('select')"
    >
      <span
        aria-hidden="true"
        class="grid size-14 shrink-0 place-items-center rounded-sm bg-linear-to-br from-[#293b70] via-[#222b50] to-[#171727] text-sky-200/80"
      >
        <Disc3 class="size-7" />
      </span>
      <AudioLines
        v-if="isCurrentTrack"
        aria-hidden="true"
        class="size-4 shrink-0 text-spotify-green"
      />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          class="truncate text-base font-medium"
          :class="isCurrentTrack ? 'text-spotify-green' : 'text-white'"
        >
          {{ title }}
        </span>
        <span class="truncate text-sm text-spotify-muted">{{ album }}</span>
      </span>
      <span class="shrink-0 pl-2 text-sm tabular-nums text-spotify-muted">{{ duration }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { AudioLines, Disc3 } from "@lucide/vue";

defineProps<{
  title: string;
  album: string;
  duration: string;
  isCurrentTrack?: boolean;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>

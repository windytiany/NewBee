<template>
  <li class="min-w-0 border-b border-white/10">
    <button
      class="focus-visible:outline-spotify-green flex w-full min-w-0 items-center gap-3 rounded-md py-2.5 text-left text-sm transition-colors focus-visible:outline-2"
      :class="isFocused ? 'bg-white/10' : 'hover:bg-white/5'"
      type="button"
      @click="emit('select')"
    >
      <span class="text-spotify-muted w-5 shrink-0 text-right tabular-nums">
        {{ index + 1 }}
      </span>
      <span class="min-w-0 flex-1 truncate font-medium">{{ track.title }}</span>
      <span class="text-spotify-muted shrink-0 tabular-nums">{{ track.duration }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import type { AlbumTrack as AlbumTrackData } from "../../types/album";

defineProps<{
  track: AlbumTrackData;
  index: number;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>

<template>
  <li
    class="grid grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-3 rounded-md border-b border-white/5 px-1 py-2.5 text-sm transition-colors hover:bg-white/5 sm:grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1fr)_3rem]"
  >
    <span class="text-spotify-muted text-right text-xs tabular-nums">{{ trackNumber }}</span>
    <span class="flex min-w-0 flex-col gap-0.5">
      <span class="truncate font-medium text-white">{{ track.title }}</span>
      <span class="text-spotify-muted truncate text-xs">{{ track.artist }}</span>
    </span>
    <span class="text-spotify-muted hidden truncate text-xs sm:block">{{ track.album }}</span>
    <span class="text-spotify-muted text-right text-xs tabular-nums">{{ track.duration }}</span>
  </li>
</template>

<script setup lang="ts">
import type { PlaylistTrackData } from "../../types/playlist";

defineProps<{
  track: PlaylistTrackData;
  trackNumber: number;
}>();
</script>

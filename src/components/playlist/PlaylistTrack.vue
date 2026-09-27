<template>
  <li class="border-b border-white/5">
    <button
      class="focus-visible:outline-spotify-green grid w-full grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-3 rounded-md px-1 py-2.5 text-left text-sm transition-colors focus-visible:outline-2 sm:grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1fr)_3rem]"
      :class="isFocused ? 'bg-spotify-interactive' : 'hover:bg-white/5'"
      type="button"
      @click="emit('select')"
      @dblclick="emit('play')"
    >
      <span class="text-spotify-muted text-right text-xs tabular-nums">{{ trackNumber }}</span>
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="truncate font-medium text-white">{{ track.title ?? "未知曲目" }}</span>
        <span class="text-spotify-muted truncate text-xs">{{ track.artist ?? "未知艺术家" }}</span>
      </span>
      <span class="text-spotify-muted hidden truncate text-xs sm:block">
        {{ track.album ?? "未知专辑" }}
      </span>
      <span class="text-spotify-muted text-right text-xs tabular-nums">{{ duration }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatTrackDuration } from "../track/formatTrackDuration.ts";
import type { PlaylistTrackData } from "../../types/playlist";

const props = defineProps<{
  track: PlaylistTrackData;
  trackNumber: number;
  isFocused: boolean;
}>();

const duration = computed(() => formatTrackDuration(props.track.durationMs) ?? "时长未知");

const emit = defineEmits<{
  select: [];
  play: [];
}>();
</script>

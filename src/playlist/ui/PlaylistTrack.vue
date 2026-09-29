<template>
  <li class="border-b border-white/5">
    <button
      data-item-interaction
      class="focus-visible:outline-spotify-green grid w-full grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-3 rounded-md px-1 py-2.5 text-left text-sm transition-colors focus-visible:outline-2 sm:grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1fr)_3rem]"
      :class="
        isFocused
          ? 'bg-spotify-track'
          : isSelected
            ? 'bg-white/10 ring-1 ring-white/10 ring-inset'
            : 'hover:bg-white/5'
      "
      type="button"
      @click="handleSelect"
      @dblclick="emit('play')"
    >
      <span class="text-spotify-muted text-right text-xs tabular-nums">{{ trackNumber }}</span>
      <span class="flex min-w-0 flex-col gap-0.5">
        <span
          class="truncate font-medium"
          :class="isCurrentTrack || isFocused ? 'text-spotify-green' : 'text-white'"
        >
          {{ track.title ?? "未知曲目" }}
        </span>
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
import type { ItemSelectionModifiers } from "@/interaction/itemFocus";
import { formatTrackDuration } from "@/utils/formatTrack.ts";
import type { PlaylistTrackData } from "@/types/playlist.ts";

const props = defineProps<{
  track: PlaylistTrackData;
  trackNumber: number;
  isFocused: boolean;
  isSelected: boolean;
  isCurrentTrack: boolean;
}>();

const duration = computed(() => formatTrackDuration(props.track.durationMs) ?? "时长未知");

const emit = defineEmits<{
  select: [modifiers: ItemSelectionModifiers];
  play: [];
}>();

function handleSelect(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (event.button !== 0) return;
  emit("select", { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
}
</script>

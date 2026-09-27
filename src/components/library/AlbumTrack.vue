<template>
  <li class="min-w-0 border-b border-white/10">
    <button
      class="focus-visible:outline-spotify-green flex w-full min-w-0 items-center gap-3 rounded-md py-2.5 pr-3 text-left text-sm transition-colors focus-visible:outline-2"
      :class="
        props.isSelected
          ? 'bg-white/10 ring-1 ring-white/10 ring-inset'
          : props.isFocused
            ? 'bg-white/10'
            : 'hover:bg-white/5'
      "
      :aria-pressed="props.isSelected ? true : undefined"
      type="button"
      @click="emit('select')"
      @dblclick="emit('play')"
    >
      <span class="text-spotify-muted w-5 shrink-0 text-right tabular-nums">
        {{ props.index + 1 }}
      </span>
      <AudioLines
        v-if="props.isCurrentTrack"
        aria-hidden="true"
        class="text-spotify-green size-4 shrink-0"
      />
      <span
        class="min-w-0 flex-1 truncate font-medium"
        :class="props.isCurrentTrack ? 'text-spotify-green' : 'text-white'"
      >
        {{ props.track.title ?? "未知曲目" }}
      </span>
      <span class="text-spotify-muted shrink-0 tabular-nums">
        {{ formatTrackDuration(props.track.durationMs) ?? "时长未知" }}
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { AudioLines } from "@lucide/vue";
import type { TrackSummary } from "../../types/library";
import { formatTrackDuration } from "../track/formatTrackDuration.ts";

const props = defineProps<{
  track: TrackSummary;
  index: number;
  isFocused: boolean;
  isSelected: boolean;
  isCurrentTrack: boolean;
}>();

const emit = defineEmits<{
  select: [];
  play: [];
}>();
</script>

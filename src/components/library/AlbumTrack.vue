<template>
  <li class="min-w-0 border-b border-white/10">
    <div class="flex min-w-0 items-center gap-1">
      <button
        class="focus-visible:outline-spotify-green flex min-w-0 flex-1 items-center gap-3 rounded-md py-2.5 text-left text-sm transition-colors focus-visible:outline-2"
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
      <button
        class="focus-visible:outline-spotify-green text-spotify-muted grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
        :aria-label="`播放 ${props.track.title ?? '未知曲目'}`"
        :disabled="props.isPlaybackPending"
        title="播放"
        type="button"
        @click="emit('play')"
      >
        <Play aria-hidden="true" class="size-4 fill-current" />
      </button>
    </div>
  </li>
</template>

<script setup lang="ts">
import { AudioLines, Play } from "@lucide/vue";
import type { TrackSummary } from "../../types/library";
import { formatTrackDuration } from "../track/formatTrackDuration.ts";

const props = defineProps<{
  track: TrackSummary;
  index: number;
  isFocused: boolean;
  isSelected: boolean;
  isCurrentTrack: boolean;
  isPlaybackPending: boolean;
}>();

const emit = defineEmits<{
  select: [];
  play: [];
}>();
</script>

<template>
  <section
    :aria-label="props.title"
    class="bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col text-white"
  >
    <h2 class="shrink-0 px-3 py-2 text-sm font-medium text-white/90">{{ props.title }}</h2>

    <div class="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
      <p v-if="props.isLoading" class="text-spotify-muted px-2 py-3 text-sm" role="status">
        正在读取曲目…
      </p>
      <p v-else-if="props.error" class="px-2 py-3 text-sm text-red-300" role="alert">
        {{ props.error }}
      </p>
      <p v-else-if="props.tracks.length === 0" class="text-spotify-muted px-2 py-3 text-sm">
        {{ props.emptyMessage }}
      </p>
      <ul v-else class="space-y-1">
        <TrackListItem
          v-for="track in props.tracks"
          :key="getTrackRowKey(track)"
          :track-id="track.trackId"
          :title="track.title ?? '未知曲目'"
          :album="track.album ?? '未知专辑'"
          :duration="formatTrackDuration(track.durationMs) ?? '时长未知'"
          :is-current-track="track.trackId === props.currentTrackId"
          :is-selected="track.trackId === props.selectedTrackId"
          :is-focused="focusedItem === getTrackFocusKey(getTrackRowKey(track))"
          @select="selectTrack(track.trackId, getTrackRowKey(track))"
        />
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useClickFocus } from "@/composables/useClickFocus";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";
import { formatTrackDuration } from "@/utils/formatTrack";
import TrackListItem from "@/components/track/TrackListItem.vue";

type Track = PlaybackDisplayTrack;

const { focusedItem, setFocusedItem } = useClickFocus();

function getTrackRowKey(track: Track) {
  return track.rowKey;
}

function getTrackFocusKey(id: string) {
  return `track:${id}`;
}

const props = withDefaults(
  defineProps<{
    tracks?: readonly Track[];
    currentTrackId?: number | null;
    selectedTrackId?: number | null;
    title?: string;
    isLoading?: boolean;
    error?: string;
    emptyMessage?: string;
  }>(),
  {
    tracks: () => [],
    currentTrackId: null,
    selectedTrackId: null,
    title: "当前曲目列表",
    isLoading: false,
    error: "",
    emptyMessage: "暂无曲目。",
  },
);

const emit = defineEmits<{
  select: [trackId: Track["trackId"]];
}>();

function selectTrack(trackId: Track["trackId"], rowKey: string) {
  setFocusedItem(getTrackFocusKey(rowKey));
  emit("select", trackId);
}
</script>

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
          :title="track.title"
          :album="track.album"
          :duration="track.duration"
          :is-current-track="track.id === props.currentTrackId"
          :is-selected="track.id === props.selectedTrackId"
          :is-focused="focusedItem === getTrackFocusKey(getTrackRowKey(track))"
          @select="selectTrack(track.id, getTrackRowKey(track))"
        />
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useClickFocus } from "../../composables/useClickFocus";
import TrackListItem from "./TrackListItem.vue";

type Track = {
  id: string | number;
  title: string;
  album: string;
  duration: string;
  rowKey?: string | number;
};

const { focusedItem, setFocusedItem } = useClickFocus();

function getTrackRowKey(track: Track) {
  return track.rowKey ?? track.id;
}

function getTrackFocusKey(id: string | number) {
  return `track:${id}`;
}

const props = withDefaults(
  defineProps<{
    tracks?: Track[];
    currentTrackId?: string | number | null;
    selectedTrackId?: string | number | null;
    title?: string;
    isLoading?: boolean;
    error?: string;
    emptyMessage?: string;
  }>(),
  {
    tracks: () => [
      { id: "moonscape", title: "moonscape", album: "last little while", duration: "4:52" },
      { id: "stargaze", title: "stargaze", album: "last little while", duration: "4:56" },
      { id: "daydream", title: "daydream", album: "last little while", duration: "6:49" },
      { id: "again", title: "again", album: "last little while", duration: "5:11" },
      { id: "insomnia", title: "insomnia", album: "last little while", duration: "9:19" },
      { id: "little-while", title: "little while", album: "last little while", duration: "6:00" },
    ],
    currentTrackId: "moonscape",
    selectedTrackId: undefined,
    title: "播放列表",
    isLoading: false,
    error: "",
    emptyMessage: "暂无曲目。",
  },
);

const emit = defineEmits<{
  select: [trackId: Track["id"]];
}>();

function selectTrack(trackId: Track["id"], rowKey: string | number) {
  setFocusedItem(getTrackFocusKey(rowKey));
  emit("select", trackId);
}
</script>

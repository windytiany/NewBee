<template>
  <section
    aria-label="播放列表"
    class="flex h-[min(90vh,60rem)] min-h-96 w-80 max-w-full flex-col bg-spotify-base text-white"
  >
    <h2 class="shrink-0 px-3 py-2 text-sm font-medium text-white/90">播放列表</h2>

    <div class="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
      <ul class="space-y-1">
        <TrackListItem
          v-for="track in props.tracks"
          :key="track.id"
          :title="track.title"
          :album="track.album"
          :duration="track.duration"
          :is-current-track="track.id === props.currentTrackId"
        />
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import TrackListItem from "./TrackListItem.vue";

type Track = {
  id: string;
  title: string;
  album: string;
  duration: string;
};

const props = withDefaults(
  defineProps<{
    tracks?: Track[];
    currentTrackId?: string | null;
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
  },
);
</script>

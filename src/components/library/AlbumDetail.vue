<template>
  <article
    class="bg-spotify-interactive rounded-lg px-5 py-5 text-white shadow-xl ring-1 ring-white/10 sm:px-7"
  >
    <header class="mb-5 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="text-spotify-muted mb-1 text-xs font-medium tracking-wide uppercase">专辑曲目</p>
        <h2 class="truncate text-xl font-bold sm:text-2xl">
          {{ props.album.album ?? "未知专辑" }}
        </h2>
        <p class="text-spotify-muted mt-1 truncate text-sm">
          {{ props.albumArtist ?? "未知演出者" }} · {{ props.album.trackCount }} 首曲目
        </p>
      </div>
      <button
        aria-label="收起专辑曲目"
        class="focus-visible:outline-spotify-green text-spotify-muted grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2"
        type="button"
        @click="emit('close')"
      >
        <X aria-hidden="true" class="size-4" />
      </button>
    </header>

    <h3 class="sr-only">曲目</h3>
    <p v-if="props.tracksLoading" class="text-spotify-muted py-3 text-sm" role="status">
      正在读取曲目…
    </p>
    <p v-else-if="props.tracksError" class="py-3 text-sm text-red-300" role="alert">
      {{ props.tracksError }}
    </p>
    <ol v-else-if="props.tracks.length > 0" class="grid gap-x-8 sm:grid-cols-2">
      <AlbumTrack
        v-for="(track, index) in props.tracks"
        :key="track.id"
        :track="track"
        :index="index"
        :is-focused="focusedItem === getTrackFocusKey(track.id)"
        :is-selected="track.id === props.selectedTrackId"
        @select="selectTrack(track.id)"
      />
    </ol>
    <p v-else class="text-spotify-muted py-3 text-sm">此专辑暂无曲目。</p>
  </article>
</template>

<script setup lang="ts">
import { X } from "@lucide/vue";
import { useClickFocus } from "../../composables/useClickFocus";
import type { AlbumSummary, TrackSummary } from "../../types/library";
import AlbumTrack from "./AlbumTrack.vue";

const props = defineProps<{
  album: AlbumSummary;
  albumArtist: string | null;
  tracks: TrackSummary[];
  selectedTrackId: number | null;
  tracksLoading: boolean;
  tracksError: string;
}>();

const emit = defineEmits<{
  close: [];
  selectTrack: [trackId: number];
}>();

const { focusedItem, setFocusedItem } = useClickFocus();

function getTrackFocusKey(id: number) {
  return `album-track:${id}`;
}

function selectTrack(trackId: number) {
  setFocusedItem(getTrackFocusKey(trackId));
  emit("selectTrack", trackId);
}
</script>

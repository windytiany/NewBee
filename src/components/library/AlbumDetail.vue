<template>
  <article
    class="bg-spotify-interactive rounded-lg px-5 py-5 text-white shadow-xl ring-1 ring-white/10 sm:px-7"
  >
    <header class="mb-5 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-3">
          <h2 class="min-w-0 flex-1 truncate text-xl font-bold sm:text-2xl">
            {{ props.album.album ?? "未知专辑" }}
          </h2>
          <button
            aria-label="播放专辑（暂未实现）"
            class="focus-visible:outline-spotify-green bg-spotify-green grid size-9 shrink-0 place-items-center rounded-full text-black opacity-50 focus-visible:outline-2 disabled:cursor-not-allowed"
            disabled
            title="播放专辑（暂未实现）"
            type="button"
          >
            <Play aria-hidden="true" class="ml-0.5 size-4 fill-current" />
          </button>
        </div>
        <p class="text-spotify-muted mt-1 truncate text-sm">{{ props.album.year ?? "年份未知" }}</p>
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
        :is-current-track="track.id === props.currentTrackId"
        @select="selectTrack(track.id)"
        @play="emit('playTrack', track.id)"
      />
    </ol>
    <p v-else class="text-spotify-muted py-3 text-sm">此专辑暂无曲目。</p>
  </article>
</template>

<script setup lang="ts">
import { Play, X } from "@lucide/vue";
import { useClickFocus } from "@/composables/useClickFocus";
import type { AlbumSummary } from "@/types/album";
import type { TrackSummary } from "@/types/track";
import AlbumTrack from "@/components/library/AlbumTrack.vue";

const props = defineProps<{
  album: AlbumSummary;
  tracks: TrackSummary[];
  selectedTrackId: number | null;
  currentTrackId: number | null;
  tracksLoading: boolean;
  tracksError: string;
}>();

const emit = defineEmits<{
  close: [];
  selectTrack: [trackId: number];
  playTrack: [trackId: number];
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

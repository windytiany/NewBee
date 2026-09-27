<template>
  <section
    aria-label="播放列表浏览"
    class="sidebar-scrollbars bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-white"
  >
    <template v-if="props.playlist">
      <header
        class="to-spotify-base shrink-0 bg-linear-to-b from-indigo-950 via-[#211a30] px-5 py-6 sm:px-8 sm:py-8"
      >
        <div class="flex items-end gap-5">
          <div
            aria-hidden="true"
            class="grid size-28 shrink-0 place-items-center rounded-md bg-linear-to-br from-violet-800 via-indigo-950 to-slate-950 shadow-xl sm:size-36"
          >
            <DiscAlbum class="size-12 text-white/75 sm:size-16" stroke-width="1.25" />
          </div>
          <div class="min-w-0 pb-1">
            <p class="mb-2 text-xs font-semibold tracking-wide text-white/75 uppercase">播放列表</p>
            <h1
              id="playlist-browser-heading"
              class="truncate text-2xl font-bold tracking-tight sm:text-4xl"
            >
              {{ props.playlist.name }}
            </h1>
          </div>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-8">
        <div
          class="bg-spotify-base/95 text-spotify-muted sticky top-0 z-10 grid grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-3 border-b border-white/10 py-2 text-xs backdrop-blur-sm sm:grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1fr)_3rem]"
        >
          <span class="text-right">#</span>
          <span>歌曲</span>
          <span class="hidden sm:block">专辑</span>
          <span class="text-right">时长</span>
        </div>

        <p v-if="props.isLoadingTracks" class="text-spotify-muted py-4 text-sm" role="status">
          正在读取歌单曲目…
        </p>
        <p v-else-if="props.playlistsError" class="py-4 text-sm text-red-300" role="alert">
          {{ props.playlistsError }}
        </p>
        <p v-else-if="props.tracksError" class="py-4 text-sm text-red-300" role="alert">
          {{ props.tracksError }}
        </p>
        <p v-else-if="props.tracks.length === 0" class="text-spotify-muted py-4 text-sm">
          此歌单暂无歌曲。
        </p>
        <ol v-else>
          <PlaylistTrack
            v-for="(track, index) in props.tracks"
            :key="track.playlistItemId"
            :track="track"
            :track-number="index + 1"
            :is-focused="focusedItem === getTrackFocusKey(track.playlistItemId)"
            @select="setFocusedItem(getTrackFocusKey(track.playlistItemId))"
            @play="emit('playTrack', track.trackId)"
          />
        </ol>
      </div>
    </template>

    <div v-else class="grid min-h-0 flex-1 place-items-center px-5 text-center">
      <p v-if="props.isLoadingPlaylists" class="text-spotify-muted text-sm" role="status">
        正在读取歌单…
      </p>
      <p v-else-if="props.playlistsError" class="text-sm text-red-300" role="alert">
        {{ props.playlistsError }}
      </p>
      <p v-else-if="!props.hasPlaylists" class="text-spotify-muted text-sm">还没有歌单。</p>
      <p v-else class="text-spotify-muted text-sm">请选择一个歌单。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { DiscAlbum } from "@lucide/vue";
import { useClickFocus } from "@/composables/useClickFocus";
import type { Playlist, PlaylistTrackData } from "@/types/playlist";
import PlaylistTrack from "@/components/playlist/PlaylistTrack.vue";

const props = defineProps<{
  playlist: Playlist | null;
  tracks: PlaylistTrackData[];
  isLoadingPlaylists: boolean;
  playlistsError: string;
  hasPlaylists: boolean;
  isLoadingTracks: boolean;
  tracksError: string;
}>();

const { focusedItem, setFocusedItem } = useClickFocus();

const emit = defineEmits<{
  playTrack: [trackId: number];
}>();

function getTrackFocusKey(playlistItemId: number) {
  return `playlist-item:${playlistItemId}`;
}
</script>

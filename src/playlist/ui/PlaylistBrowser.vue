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
          <div class="min-w-0 flex-1 pb-1">
            <p class="mb-2 text-xs font-semibold tracking-wide text-white/75 uppercase">播放列表</p>
            <h1
              id="playlist-browser-heading"
              class="truncate text-2xl font-bold tracking-tight sm:text-4xl"
            >
              {{ props.playlist.name }}
            </h1>
          </div>
          <button
            aria-label="播放歌单"
            class="focus-visible:outline-spotify-green bg-spotify-green grid size-11 shrink-0 place-items-center rounded-full text-black transition-transform focus-visible:outline-2"
            :class="
              props.isLoadingTracks || props.tracks.length === 0
                ? 'cursor-not-allowed opacity-50'
                : 'hover:scale-105 active:scale-95'
            "
            :disabled="props.isLoadingTracks || props.tracks.length === 0"
            title="播放歌单"
            type="button"
            @click="emit('playPlaylist')"
          >
            <Play aria-hidden="true" class="ml-0.5 size-5 fill-current" />
          </button>
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
            :is-focused="playlistTrackFocus.isFocused(String(track.playlistItemId))"
            :is-selected="playlistTrackFocus.isSelected(String(track.playlistItemId))"
            :is-current-track="props.currentRowKey === getTrackRowKey(track.playlistItemId)"
            @select="selectTrack(track.playlistItemId, $event)"
            @play="emit('playTrack', track.playlistItemId)"
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
import { computed, watch } from "vue";
import { DiscAlbum, Play } from "@lucide/vue";
import { useItemFocusList } from "@/interaction/itemFocus";
import type { ItemSelectionModifiers } from "@/interaction/itemFocus";
import type { Playlist, PlaylistTrackData } from "@/types/playlist";
import PlaylistTrack from "@/playlist/ui/PlaylistTrack.vue";

const props = defineProps<{
  playlist: Playlist | null;
  tracks: PlaylistTrackData[];
  currentRowKey: string | null;
  isLoadingPlaylists: boolean;
  playlistsError: string;
  hasPlaylists: boolean;
  isLoadingTracks: boolean;
  tracksError: string;
}>();

const playlistTrackScope = computed(() =>
  JSON.stringify(["playlist", "tracks", props.playlist?.id ?? null]),
);
const playlistTrackFocus = useItemFocusList(playlistTrackScope);
const visibleTrackKeys = computed(() => props.tracks.map((track) => String(track.playlistItemId)));

watch(visibleTrackKeys, (itemKeys) => playlistTrackFocus.syncVisibleItems(itemKeys), {
  immediate: true,
});

const emit = defineEmits<{
  playTrack: [playlistItemId: number];
  playPlaylist: [];
}>();

function getTrackRowKey(playlistItemId: number) {
  return `playlist-item:${playlistItemId}`;
}

function selectTrack(playlistItemId: number, modifiers: ItemSelectionModifiers) {
  playlistTrackFocus.selectItem(String(playlistItemId), visibleTrackKeys.value, modifiers);
}
</script>

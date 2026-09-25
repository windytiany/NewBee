<template>
  <section
    v-if="props.playlist"
    aria-labelledby="playlist-browser-heading"
    class="sidebar-scrollbars bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-white"
  >
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

      <ol>
        <PlaylistTrack
          v-for="(track, index) in props.playlist.tracks"
          :key="track.id"
          :track="track"
          :track-number="index + 1"
        />
      </ol>
    </div>
  </section>
</template>

<script setup lang="ts">
import { DiscAlbum } from "@lucide/vue";
import type { Playlist } from "../../types/playlist";
import PlaylistTrack from "./PlaylistTrack.vue";

const props = defineProps<{
  playlist: Playlist | null;
}>();
</script>

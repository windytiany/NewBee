<template>
  <article
    class="bg-spotify-interactive rounded-lg px-5 py-5 text-white shadow-xl ring-1 ring-white/10 sm:px-7"
  >
    <header class="mb-5 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="text-spotify-muted mb-1 text-xs font-medium tracking-wide uppercase">专辑详情</p>
        <h2 class="truncate text-xl font-bold sm:text-2xl">{{ album.title }}</h2>
        <p class="text-spotify-muted mt-1 truncate text-sm">
          {{ album.artist }} · {{ album.year }}
        </p>
      </div>
      <button
        aria-label="关闭专辑详情"
        class="focus-visible:outline-spotify-green text-spotify-muted grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2"
        type="button"
        @click="emit('close')"
      >
        <X aria-hidden="true" class="size-4" />
      </button>
    </header>

    <h3 class="sr-only">曲目</h3>
    <ol class="grid gap-x-8 sm:grid-cols-2">
      <AlbumTrack
        v-for="(track, index) in album.tracks"
        :key="track.id"
        :track="track"
        :index="index"
      />
    </ol>
  </article>
</template>

<script setup lang="ts">
import { X } from "@lucide/vue";
import type { Album } from "../../types/album";
import AlbumTrack from "./AlbumTrack.vue";

defineProps<{
  album: Album;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

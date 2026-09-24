<template>
  <section
    aria-label="曲目信息"
    class="flex h-[min(90vh,60rem)] min-h-96 w-80 max-w-full flex-col overflow-y-auto bg-spotify-base text-white"
  >
    <h2 class="shrink-0 px-3 py-2 text-sm font-medium text-white/90">曲目信息</h2>

    <div class="px-3 pb-3">
      <h1 class="truncate text-lg font-bold">{{ props.track.title }}</h1>
      <p class="truncate text-sm text-spotify-muted">{{ props.track.album }}</p>
      <p class="truncate text-sm text-spotify-muted">{{ props.track.artist }}</p>
      <p class="text-sm text-spotify-muted">{{ props.track.year }}</p>
      <p class="mt-1 text-xs leading-relaxed text-spotify-muted">
        {{ props.track.codecInfo }} · {{ props.track.duration }}
      </p>

      <div
        :aria-label="`${props.track.album} album cover placeholder`"
        class="mt-4 grid aspect-square w-full place-items-center bg-linear-to-br from-[#182c68] via-[#10142e] to-[#090a12] text-blue-300/70"
        role="img"
      >
        <Disc3 aria-hidden="true" class="size-20" stroke-width="1" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Disc3 } from "@lucide/vue";

type TrackInfoData = {
  title: string;
  artist: string;
  album: string;
  year: number | string;
  codecInfo: string;
  duration: string;
};

const props = withDefaults(defineProps<{ track?: TrackInfoData }>(), {
  track: () => ({
    title: "moonscape",
    artist: "fade",
    album: "last little while",
    year: 2016,
    codecInfo: "FLAC 44.1 kHz, 844k, 立体声",
    duration: "4:52",
  }),
});
</script>

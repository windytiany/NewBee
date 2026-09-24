<template>
  <footer
    aria-label="Playback controls"
    class="fixed inset-x-0 bottom-0 z-50 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 bg-spotify-surface px-4 py-1 text-spotify-muted sm:h-10 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:gap-x-6 sm:px-6 sm:py-0 md:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)_minmax(8rem,14rem)] md:gap-x-8 md:pl-8 md:pr-4"
  >
    <div class="col-start-1 row-start-1 flex min-w-0 items-center gap-4 md:gap-5">
      <div class="flex items-center gap-1">
        <button
          aria-label="Previous track"
          class="grid size-8 place-items-center rounded-full text-spotify-muted transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green"
          type="button"
        >
          <SkipBack aria-hidden="true" class="size-4" />
        </button>
        <button
          aria-label="Play"
          class="grid size-8 place-items-center rounded-full bg-spotify-green text-black transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green"
          type="button"
        >
          <Play aria-hidden="true" class="size-5 fill-current" />
        </button>
        <button
          aria-label="Next track"
          class="grid size-8 place-items-center rounded-full text-spotify-muted transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green"
          type="button"
        >
          <SkipForward aria-hidden="true" class="size-4" />
        </button>
      </div>

      <div class="hidden min-w-0 items-center gap-3 text-spotify-muted md:flex">
        <Volume2 aria-hidden="true" class="size-4 shrink-0" />
        <div aria-hidden="true" class="relative h-1 w-20 rounded-full bg-spotify-track">
          <div class="h-full w-1/2 rounded-full bg-spotify-muted" />
          <span class="absolute left-1/2 top-1/2 size-2 -translate-y-1/2 rounded-full bg-white" />
        </div>
      </div>
    </div>

    <section
      class="col-span-full row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:flex sm:h-full sm:flex-col sm:py-1"
    >
      <div class="grid grid-cols-[4rem_minmax(0,1fr)_5rem] items-center text-xs sm:h-5">
        <span aria-hidden="true" />
        <span class="truncate text-center text-sm font-bold text-white">Title - Artist</span>
        <span class="text-right tabular-nums text-spotify-muted">0:00/0:00</span>
      </div>
      <div
        aria-label="Playback progress"
        aria-valuemax="100"
        aria-valuemin="0"
        aria-valuenow="0"
        class="mt-1 h-1 rounded-full bg-spotify-track sm:mb-1"
        role="progressbar"
      >
        <div class="h-full w-0 rounded-full bg-spotify-green" />
      </div>
    </section>

    <div
      aria-label="Playback options"
      class="col-start-2 row-start-1 flex items-center justify-end gap-2 text-spotify-muted sm:col-start-3 sm:justify-end"
    >
      <button
        aria-label="Repeat one"
        class="grid size-8 place-items-center rounded-full text-spotify-muted transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green"
        type="button"
      >
        <Repeat1 aria-hidden="true" class="size-4" />
      </button>
      <button
        aria-label="Shuffle playback"
        class="grid size-8 place-items-center rounded-full text-spotify-muted transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green"
        type="button"
      >
        <Shuffle aria-hidden="true" class="size-4" />
      </button>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { Play, Repeat1, Shuffle, SkipBack, SkipForward, Volume2 } from "@lucide/vue";
</script>

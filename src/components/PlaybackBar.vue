<template>
  <footer
    aria-label="Playback controls"
    class="bg-spotify-surface text-spotify-muted fixed inset-x-0 bottom-0 z-50 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-1 sm:h-10 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:gap-x-6 sm:px-6 sm:py-0 md:grid-cols-[minmax(14.5rem,20rem)_minmax(25.5rem,1fr)_minmax(4.5rem,14rem)] md:gap-x-[clamp(4px,calc(9.459459459vw-68.64864865px),32px)] md:pr-4 md:pl-8"
  >
    <div class="col-start-1 row-start-1 flex min-w-0 items-center gap-4 md:gap-5">
      <div class="flex items-center gap-1">
        <button
          aria-label="Previous track"
          class="text-spotify-muted focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2"
          type="button"
        >
          <SkipBack aria-hidden="true" class="size-4" />
        </button>
        <button
          aria-label="Play"
          class="bg-spotify-green focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full text-black transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2"
          type="button"
        >
          <Play aria-hidden="true" class="size-5 fill-current" />
        </button>
        <button
          aria-label="Next track"
          class="text-spotify-muted focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2"
          type="button"
        >
          <SkipForward aria-hidden="true" class="size-4" />
        </button>
      </div>

      <div ref="volumeControl" class="text-spotify-muted relative flex shrink-0 items-center gap-3">
        <button
          aria-label="Volume controls"
          aria-controls="volume-popover"
          class="focus-visible:outline-spotify-green grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 lg:-mx-2"
          :aria-expanded="isVolumePopoverOpen"
          type="button"
          @click="isVolumePopoverOpen = !isVolumePopoverOpen"
        >
          <Volume2 aria-hidden="true" class="size-4" />
        </button>
        <div
          aria-hidden="true"
          class="bg-spotify-track relative hidden h-1 w-20 shrink-0 rounded-full lg:block"
        >
          <div class="bg-spotify-muted h-full rounded-full" :style="{ width: `${volume}%` }" />
          <span
            class="absolute top-1/2 left-1/2 size-2 -translate-y-1/2 rounded-full bg-white"
            :style="{ left: `${volume}%` }"
          />
        </div>
        <div
          v-if="isVolumePopoverOpen"
          id="volume-popover"
          class="bg-spotify-interactive absolute bottom-full left-1/2 z-10 mb-2 flex h-36 w-10 -translate-x-1/2 items-center justify-center rounded-lg shadow-lg"
        >
          <div class="bg-spotify-track relative h-28 w-1 rounded-full">
            <div
              class="bg-spotify-muted absolute inset-x-0 bottom-0 rounded-full"
              :style="{ height: `${volume}%` }"
            />
            <span
              class="absolute left-1/2 size-2 -translate-x-1/2 rounded-full bg-white"
              :style="{ bottom: `${volume}%` }"
            />
            <input
              v-model.number="volume"
              aria-label="Volume"
              aria-orientation="vertical"
              class="absolute top-0 left-1/2 h-full w-10 -translate-x-1/2 cursor-pointer opacity-0 [direction:rtl] [writing-mode:vertical-lr]"
              max="100"
              min="0"
              type="range"
            />
          </div>
        </div>
      </div>
    </div>

    <section
      class="col-span-full row-start-2 min-w-0 sm:absolute sm:top-0 sm:left-1/2 sm:col-auto sm:row-auto sm:flex sm:h-full sm:w-[min(24rem,calc(100vw-22.5rem))] sm:-translate-x-1/2 sm:flex-col sm:py-1 md:w-[max(24rem,calc(100vw-41rem))]"
    >
      <div class="flex items-center justify-end text-xs sm:h-5">
        <span class="text-spotify-muted text-right tabular-nums">0:00/0:00</span>
      </div>
      <span
        class="pointer-events-none absolute top-10 left-1/2 max-w-56 -translate-x-1/2 truncate text-center text-sm font-bold text-white sm:top-1"
      >
        Title - Artist
      </span>
      <div
        aria-label="Playback progress"
        aria-valuemax="100"
        aria-valuemin="0"
        aria-valuenow="0"
        class="bg-spotify-track mt-1 h-1 rounded-full sm:mb-1"
        role="progressbar"
      >
        <div class="bg-spotify-green h-full w-0 rounded-full" />
      </div>
    </section>

    <div
      aria-label="Playback options"
      class="text-spotify-muted col-start-2 row-start-1 flex items-center justify-end gap-2 sm:col-start-3 sm:justify-end"
    >
      <button
        aria-label="Repeat one"
        class="text-spotify-muted focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2"
        type="button"
      >
        <Repeat1 aria-hidden="true" class="size-4" />
      </button>
      <button
        aria-label="Shuffle playback"
        class="text-spotify-muted focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2"
        type="button"
      >
        <Shuffle aria-hidden="true" class="size-4" />
      </button>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Play, Repeat1, Shuffle, SkipBack, SkipForward, Volume2 } from "@lucide/vue";

const volume = ref(50);
const isVolumePopoverOpen = ref(false);
const volumeControl = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);

function closeVolumePopoverOnOutsidePointer(event: InstanceType<typeof globalThis.PointerEvent>) {
  if (event.target instanceof globalThis.Node && volumeControl.value?.contains(event.target)) {
    return;
  }

  isVolumePopoverOpen.value = false;
}

function closeVolumePopoverOnEscape(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (event.key === "Escape") isVolumePopoverOpen.value = false;
}

onMounted(() => {
  globalThis.document.addEventListener("pointerdown", closeVolumePopoverOnOutsidePointer);
  globalThis.document.addEventListener("keydown", closeVolumePopoverOnEscape);
});

onUnmounted(() => {
  globalThis.document.removeEventListener("pointerdown", closeVolumePopoverOnOutsidePointer);
  globalThis.document.removeEventListener("keydown", closeVolumePopoverOnEscape);
});
</script>

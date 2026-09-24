<template>
  <footer
    aria-label="Playback controls"
    class="fixed inset-x-0 bottom-0 z-50 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 bg-spotify-surface px-4 py-1 text-spotify-muted sm:h-10 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:gap-x-6 sm:px-6 sm:py-0 md:grid-cols-[minmax(14.5rem,20rem)_minmax(25.5rem,1fr)_minmax(4.5rem,14rem)] md:gap-x-[clamp(4px,calc(9.459459459vw-68.64864865px),32px)] md:pl-8 md:pr-4"
  >
    <div class="col-start-1 row-start-1 flex min-w-0 items-center gap-4 md:gap-5">
      <div class="flex items-center gap-1">
        <button
          aria-label="Previous track"
          class="grid size-8 place-items-center rounded-full text-spotify-muted transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green"
          type="button"
        >
          <SkipBack aria-hidden="true" class="size-4" />
        </button>
        <button
          aria-label="Play"
          class="grid size-8 place-items-center rounded-full bg-spotify-green text-black transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green"
          type="button"
        >
          <Play aria-hidden="true" class="size-5 fill-current" />
        </button>
        <button
          aria-label="Next track"
          class="grid size-8 place-items-center rounded-full text-spotify-muted transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green"
          type="button"
        >
          <SkipForward aria-hidden="true" class="size-4" />
        </button>
      </div>

      <div ref="volumeControl" class="relative flex shrink-0 items-center gap-3 text-spotify-muted">
        <button
          aria-label="Volume controls"
          aria-controls="volume-popover"
          class="grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green lg:-mx-2"
          :aria-expanded="isVolumePopoverOpen"
          type="button"
          @click="isVolumePopoverOpen = !isVolumePopoverOpen"
        >
          <Volume2 aria-hidden="true" class="size-4" />
        </button>
        <div
          aria-hidden="true"
          class="relative hidden h-1 w-20 shrink-0 rounded-full bg-spotify-track lg:block"
        >
          <div class="h-full rounded-full bg-spotify-muted" :style="{ width: `${volume}%` }" />
          <span
            class="absolute left-1/2 top-1/2 size-2 -translate-y-1/2 rounded-full bg-white"
            :style="{ left: `${volume}%` }"
          />
        </div>
        <div
          v-if="isVolumePopoverOpen"
          id="volume-popover"
          class="absolute bottom-full left-1/2 z-10 mb-2 flex h-36 w-10 -translate-x-1/2 items-center justify-center rounded-lg bg-spotify-interactive shadow-lg"
        >
          <div class="relative h-28 w-1 rounded-full bg-spotify-track">
            <div
              class="absolute inset-x-0 bottom-0 rounded-full bg-spotify-muted"
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
              class="absolute left-1/2 top-0 h-full w-10 -translate-x-1/2 cursor-pointer opacity-0 [writing-mode:vertical-lr] [direction:rtl]"
              max="100"
              min="0"
              type="range"
            />
          </div>
        </div>
      </div>
    </div>

    <section
      class="col-span-full row-start-2 min-w-0 sm:absolute sm:col-auto sm:row-auto sm:left-1/2 sm:top-0 sm:w-[min(24rem,calc(100vw-22.5rem))] sm:-translate-x-1/2 sm:flex sm:h-full sm:flex-col sm:py-1 md:w-[max(24rem,calc(100vw-41rem))]"
    >
      <div class="flex items-center justify-end text-xs sm:h-5">
        <span class="text-right tabular-nums text-spotify-muted">0:00/0:00</span>
      </div>
      <span
        class="pointer-events-none absolute left-1/2 top-10 max-w-56 -translate-x-1/2 truncate text-center text-sm font-bold text-white sm:top-1"
      >
        Title - Artist
      </span>
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
        class="grid size-8 place-items-center rounded-full text-spotify-muted transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green"
        type="button"
      >
        <Repeat1 aria-hidden="true" class="size-4" />
      </button>
      <button
        aria-label="Shuffle playback"
        class="grid size-8 place-items-center rounded-full text-spotify-muted transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green"
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

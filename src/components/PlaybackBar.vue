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
          :aria-label="
            isHorizontalVolumeVisible ? (volume === 0 ? 'Unmute' : 'Mute') : 'Volume controls'
          "
          :aria-controls="isHorizontalVolumeVisible ? undefined : 'volume-popover'"
          class="focus-visible:outline-spotify-green grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 lg:-mx-2"
          :aria-expanded="isHorizontalVolumeVisible ? undefined : isVolumePopoverOpen"
          :aria-pressed="isHorizontalVolumeVisible ? volume === 0 : undefined"
          type="button"
          @click="handleVolumeButtonClick"
        >
          <VolumeX v-if="volume === 0" aria-hidden="true" class="size-4" />
          <Volume2 v-else aria-hidden="true" class="size-4" />
        </button>
        <div class="bg-spotify-track relative hidden h-1 w-20 shrink-0 rounded-full lg:block">
          <div class="bg-spotify-muted h-full rounded-full" :style="{ width: `${volume}%` }" />
          <span
            class="absolute top-1/2 left-1/2 size-2 -translate-y-1/2 rounded-full bg-white"
            :style="{ left: `${volume}%` }"
          />
          <input
            v-model.number="volume"
            aria-label="Volume"
            class="absolute top-1/2 left-0 z-10 h-6 w-full -translate-y-1/2 cursor-pointer opacity-0"
            max="100"
            min="0"
            step="1"
            type="range"
          />
        </div>
        <div
          v-if="isVolumePopoverOpen && !isHorizontalVolumeVisible"
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
              step="1"
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
        class="focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        :class="isRepeatEnabled ? 'text-spotify-green' : 'text-spotify-muted hover:text-white'"
        :aria-pressed="isRepeatEnabled"
        type="button"
        @click="isRepeatEnabled = !isRepeatEnabled"
      >
        <Repeat1 aria-hidden="true" class="size-4" />
      </button>
      <button
        aria-label="Shuffle playback"
        class="focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        :class="isShuffleEnabled ? 'text-spotify-green' : 'text-spotify-muted hover:text-white'"
        :aria-pressed="isShuffleEnabled"
        type="button"
        @click="isShuffleEnabled = !isShuffleEnabled"
      >
        <Shuffle aria-hidden="true" class="size-4" />
      </button>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { Play, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "@lucide/vue";

const DEFAULT_VOLUME = 50;
const VOLUME_STORAGE_KEY = "newbee.playback-volume";

type PlaybackVolumeState = {
  volume: number;
  lastNonMutedVolume: number;
};

const DEFAULT_PLAYBACK_VOLUME = {
  volume: DEFAULT_VOLUME,
  lastNonMutedVolume: DEFAULT_VOLUME,
} satisfies PlaybackVolumeState;

function isVolumeLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

function loadPlaybackVolume(): PlaybackVolumeState {
  try {
    const serializedVolume = globalThis.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (serializedVolume === null) return { ...DEFAULT_PLAYBACK_VOLUME };

    const parsedVolume: unknown = JSON.parse(serializedVolume);
    if (typeof parsedVolume !== "object" || parsedVolume === null || Array.isArray(parsedVolume)) {
      globalThis.console.error("Saved playback volume has an invalid format; using the default.");
      return { ...DEFAULT_PLAYBACK_VOLUME };
    }

    const storedVolume = parsedVolume as Record<string, unknown>;
    if (
      !isVolumeLevel(storedVolume.volume) ||
      !isVolumeLevel(storedVolume.lastNonMutedVolume) ||
      storedVolume.lastNonMutedVolume === 0
    ) {
      globalThis.console.error("Saved playback volume is invalid; using the default.");
      return { ...DEFAULT_PLAYBACK_VOLUME };
    }

    return {
      volume: storedVolume.volume,
      lastNonMutedVolume:
        storedVolume.volume > 0 ? storedVolume.volume : storedVolume.lastNonMutedVolume,
    };
  } catch (error) {
    globalThis.console.error("Could not read saved playback volume; using the default.", error);
    return { ...DEFAULT_PLAYBACK_VOLUME };
  }
}

function savePlaybackVolume(volume: number, lastNonMutedVolume: number) {
  try {
    globalThis.localStorage.setItem(
      VOLUME_STORAGE_KEY,
      JSON.stringify({ volume, lastNonMutedVolume }),
    );
  } catch (error) {
    globalThis.console.error("Could not save playback volume.", error);
  }
}

const initialVolume = loadPlaybackVolume();
const volume = ref(initialVolume.volume);
const lastNonMutedVolume = ref(initialVolume.lastNonMutedVolume);
const isVolumePopoverOpen = ref(false);
const isHorizontalVolumeVisible = ref(false);
const isRepeatEnabled = ref(false);
const isShuffleEnabled = ref(false);
const volumeControl = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
let volumeLayoutQuery: ReturnType<typeof globalThis.matchMedia> | null = null;

watch(
  volume,
  (nextVolume) => {
    if (nextVolume > 0) lastNonMutedVolume.value = nextVolume;
    savePlaybackVolume(nextVolume, lastNonMutedVolume.value);
  },
  { flush: "sync" },
);

function updateVolumeLayout() {
  if (!volumeLayoutQuery) return;

  isHorizontalVolumeVisible.value = volumeLayoutQuery.matches;
  if (isHorizontalVolumeVisible.value) isVolumePopoverOpen.value = false;
}

function toggleMute() {
  if (volume.value > 0) {
    lastNonMutedVolume.value = volume.value;
    volume.value = 0;
    return;
  }

  volume.value = lastNonMutedVolume.value;
}

function handleVolumeButtonClick() {
  if (isHorizontalVolumeVisible.value) {
    toggleMute();
    return;
  }

  isVolumePopoverOpen.value = !isVolumePopoverOpen.value;
}

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
  volumeLayoutQuery = globalThis.matchMedia("(min-width: 64rem)");
  updateVolumeLayout();
  volumeLayoutQuery.addEventListener("change", updateVolumeLayout);
  globalThis.document.addEventListener("pointerdown", closeVolumePopoverOnOutsidePointer);
  globalThis.document.addEventListener("keydown", closeVolumePopoverOnEscape);
});

onUnmounted(() => {
  volumeLayoutQuery?.removeEventListener("change", updateVolumeLayout);
  globalThis.document.removeEventListener("pointerdown", closeVolumePopoverOnOutsidePointer);
  globalThis.document.removeEventListener("keydown", closeVolumePopoverOnEscape);
});
</script>

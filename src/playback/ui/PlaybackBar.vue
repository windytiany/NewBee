<template>
  <footer
    aria-label="Playback controls"
    class="bg-spotify-surface text-spotify-muted fixed inset-x-0 bottom-0 z-50 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-1 sm:h-10 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:gap-x-6 sm:px-6 sm:py-0 md:grid-cols-[minmax(14.5rem,20rem)_minmax(25.5rem,1fr)_minmax(4.5rem,14rem)] md:gap-x-[clamp(4px,calc(9.459459459vw-68.64864865px),32px)] md:pr-4 md:pl-8"
  >
    <div class="col-start-1 row-start-1 flex min-w-0 items-center gap-4 md:gap-5">
      <div class="flex items-center gap-1">
        <button
          aria-label="Previous track"
          class="text-spotify-muted focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="canPlayPrevious ? 'hover:text-white' : 'cursor-not-allowed opacity-50'"
          :disabled="!canPlayPrevious"
          type="button"
          @click="playPreviousTrack"
        >
          <SkipBack aria-hidden="true" class="size-4" />
        </button>
        <button
          :aria-label="playbackStatus.isPlaying ? 'Pause' : 'Play'"
          class="bg-spotify-green focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full text-black transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="
            isPlaybackCommandPending || isSeeking || (!currentTrack && !canStartRestoredQueue)
          "
          type="button"
          @click="togglePlayback"
        >
          <Pause v-if="playbackStatus.isPlaying" aria-hidden="true" class="size-5 fill-current" />
          <Play v-else aria-hidden="true" class="size-5 fill-current" />
        </button>
        <button
          aria-label="Next track"
          class="text-spotify-muted focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="canPlayNext ? 'hover:text-white' : 'cursor-not-allowed opacity-50'"
          :disabled="!canPlayNext"
          type="button"
          @click="playNextTrack"
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
      class="relative col-span-full row-start-2 min-w-0 sm:absolute sm:top-0 sm:left-1/2 sm:col-auto sm:row-auto sm:flex sm:h-full sm:w-[min(24rem,calc(100vw-22.5rem))] sm:-translate-x-1/2 sm:flex-col sm:py-1 md:w-[max(24rem,calc(100vw-41rem))]"
    >
      <p
        v-if="playbackFeedback"
        class="bg-spotify-interactive absolute right-0 bottom-full z-20 mb-2 max-w-[min(22rem,calc(100vw-2rem))] rounded-lg px-3 py-2 text-left text-xs whitespace-pre-line text-red-200 shadow-lg"
        role="alert"
      >
        {{ playbackFeedback }}
      </p>
      <div class="flex items-center justify-end text-xs sm:h-5">
        <span class="text-spotify-muted text-right tabular-nums">
          {{ formatTime(sliderPositionMs) }}/{{ formatTime(playbackStatus.durationMs) }}
        </span>
      </div>
      <span
        class="pointer-events-none absolute top-10 left-1/2 w-max max-w-[calc(100%-8rem)] -translate-x-1/2 truncate text-center text-sm font-bold text-white sm:top-1"
      >
        <template v-if="currentTrack">
          {{ currentTrack.title ?? "未知曲目" }} - {{ currentTrack.artist ?? "未知演出者" }}
        </template>
        <template v-else>未选择歌曲</template>
      </span>
      <div class="bg-spotify-track relative mt-1 h-1 rounded-full sm:mb-1">
        <div
          class="bg-spotify-green h-full rounded-full"
          :style="{ width: `${progressPercent}%` }"
        />
        <span
          class="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          :style="{ left: `${progressPercent}%` }"
        />
        <input
          aria-label="Playback progress"
          :aria-valuetext="`${formatTime(sliderPositionMs)} of ${formatTime(playbackStatus.durationMs)}`"
          class="focus-visible:outline-spotify-green absolute top-1/2 left-0 z-10 h-6 w-full -translate-y-1/2 cursor-pointer opacity-0 focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed"
          :disabled="
            !playbackStatus.hasAudio || playbackStatus.durationMs === 0 || isPlaybackCommandPending
          "
          :max="Math.max(playbackStatus.durationMs, 1)"
          min="0"
          step="1"
          :value="sliderPositionMs"
          type="range"
          @input="handleSeekInput"
          @change="commitSeek"
        />
      </div>
    </section>

    <div
      aria-label="Playback options"
      class="text-spotify-muted col-start-2 row-start-1 flex items-center justify-end gap-2 sm:col-start-3 sm:justify-end"
    >
      <button
        aria-label="Repeat one"
        class="focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        :class="repeatOneEnabled ? 'text-spotify-green' : 'text-spotify-muted hover:text-white'"
        :aria-pressed="repeatOneEnabled"
        type="button"
        @click="setRepeatOneEnabled(!repeatOneEnabled)"
      >
        <Repeat1 aria-hidden="true" class="size-4" />
      </button>
      <button
        aria-label="Shuffle playback"
        class="focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        :class="shuffleEnabled ? 'text-spotify-green' : 'text-spotify-muted hover:text-white'"
        :aria-pressed="shuffleEnabled"
        type="button"
        @click="setShuffleEnabled(!shuffleEnabled)"
      >
        <Shuffle aria-hidden="true" class="size-4" />
      </button>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { usePlaybackControls } from "@/playback/useControls";
import { usePlaybackVolume } from "@/playback/useVolume";
import {
  Pause,
  Play,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "@lucide/vue";

const { volume, volumeError, toggleMute, ensureCurrentVolumeIsSynchronized } = usePlaybackVolume();
const isVolumePopoverOpen = ref(false);
const isHorizontalVolumeVisible = ref(false);
const volumeControl = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
let volumeLayoutQuery: ReturnType<typeof globalThis.matchMedia> | null = null;

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateVolumeLayout() {
  if (!volumeLayoutQuery) return;

  isHorizontalVolumeVisible.value = volumeLayoutQuery.matches;
  if (isHorizontalVolumeVisible.value) isVolumePopoverOpen.value = false;
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

const {
  playbackStatus,
  playbackError,
  isSeeking,
  selectedPositionMs,
  currentTrack,
  isPlaybackCommandPending,
  playbackStartError,
  queuePlaybackError,
  canStartRestoredQueue,
  canPlayPrevious,
  canPlayNext,
  repeatOneEnabled,
  shuffleEnabled,
  setRepeatOneEnabled,
  setShuffleEnabled,
  playPreviousTrack,
  playNextTrack,
  togglePlayback,
  handleSeekInput,
  commitSeek,
} = usePlaybackControls(ensureCurrentVolumeIsSynchronized);

onUnmounted(() => {
  volumeLayoutQuery?.removeEventListener("change", updateVolumeLayout);
  globalThis.document.removeEventListener("pointerdown", closeVolumePopoverOnOutsidePointer);
  globalThis.document.removeEventListener("keydown", closeVolumePopoverOnEscape);
});

const sliderPositionMs = computed(() =>
  isSeeking.value ? selectedPositionMs.value : playbackStatus.value.positionMs,
);
const playbackFeedback = computed(() =>
  [playbackError.value, playbackStartError.value, queuePlaybackError.value, volumeError.value]
    .filter(Boolean)
    .join(" "),
);
const progressPercent = computed(() =>
  playbackStatus.value.durationMs > 0
    ? (sliderPositionMs.value / playbackStatus.value.durationMs) * 100
    : 0,
);
</script>

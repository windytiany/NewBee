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
          :aria-label="playbackStatus.isPlaying ? 'Pause' : 'Play'"
          class="bg-spotify-green focus-visible:outline-spotify-green grid size-8 place-items-center rounded-full text-black transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isPlaybackCommandPending || isSeeking"
          type="button"
          @click="togglePlayback"
        >
          <Pause v-if="playbackStatus.isPlaying" aria-hidden="true" class="size-5 fill-current" />
          <Play v-else aria-hidden="true" class="size-5 fill-current" />
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
      class="relative col-span-full row-start-2 min-w-0 sm:absolute sm:top-0 sm:left-1/2 sm:col-auto sm:row-auto sm:flex sm:h-full sm:w-[min(24rem,calc(100vw-22.5rem))] sm:-translate-x-1/2 sm:flex-col sm:py-1 md:w-[max(24rem,calc(100vw-41rem))]"
    >
      <p
        v-if="playbackError"
        class="bg-spotify-interactive absolute right-0 bottom-full z-20 mb-2 max-w-[min(22rem,calc(100vw-2rem))] rounded-lg px-3 py-2 text-left text-xs text-red-200 shadow-lg"
        role="alert"
      >
        {{ playbackError }}
      </p>
      <div class="flex items-center justify-end text-xs sm:h-5">
        <span class="text-spotify-muted text-right tabular-nums">
          {{ formatTime(sliderPositionMs) }}/{{ formatTime(playbackStatus.durationMs) }}
        </span>
      </div>
      <span
        class="pointer-events-none absolute top-10 left-1/2 max-w-56 -translate-x-1/2 truncate text-center text-sm font-bold text-white sm:top-1"
      >
        Title - Artist
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
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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

// Temporary local file path. Replace this with the audio file path on your computer.
const TEMP_AUDIO_PATH =
  "D:/Music/American Football/American Football/01 - American Football - Never Meant.flac";
const PLAYBACK_STATUS_POLL_INTERVAL_MS = 500;

const DEFAULT_VOLUME = 50;
const VOLUME_STORAGE_KEY = "newbee.playback-volume";

type PlaybackVolumeState = {
  volume: number;
  lastNonMutedVolume: number;
};

type PlaybackStatus = {
  hasAudio: boolean;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
};

const EMPTY_PLAYBACK_STATUS = {
  hasAudio: false,
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
} satisfies PlaybackStatus;

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
const playbackStatus = ref<PlaybackStatus>({ ...EMPTY_PLAYBACK_STATUS });
const playbackError = ref("");
const isPlaybackCommandPending = ref(false);
const isSeeking = ref(false);
const selectedPositionMs = ref(0);
const sliderPositionMs = computed(() =>
  isSeeking.value ? selectedPositionMs.value : playbackStatus.value.positionMs,
);
const progressPercent = computed(() =>
  playbackStatus.value.durationMs > 0
    ? (sliderPositionMs.value / playbackStatus.value.durationMs) * 100
    : 0,
);
const volumeControl = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
let volumeLayoutQuery: ReturnType<typeof globalThis.matchMedia> | null = null;
let playbackStatusPoll: ReturnType<typeof globalThis.setInterval> | null = null;
let statusRequestsInFlight = 0;
let statusRequestVersion = 0;

watch(
  volume,
  (nextVolume) => {
    if (nextVolume > 0) lastNonMutedVolume.value = nextVolume;
    savePlaybackVolume(nextVolume, lastNonMutedVolume.value);
  },
  { flush: "sync" },
);

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

async function refreshPlaybackStatus(force = false): Promise<boolean> {
  if (statusRequestsInFlight > 0 && !force) return false;

  statusRequestsInFlight += 1;
  const requestVersion = ++statusRequestVersion;
  try {
    const status = await invoke<PlaybackStatus>("playback_status");
    if (requestVersion !== statusRequestVersion) return false;

    playbackStatus.value = status;
    if (playbackError.value.startsWith("Playback status unavailable:")) playbackError.value = "";
    return true;
  } catch (error) {
    if (requestVersion === statusRequestVersion) {
      playbackError.value = `Playback status unavailable: ${errorMessage(error)}`;
    }
    return false;
  } finally {
    statusRequestsInFlight -= 1;
  }
}

async function togglePlayback() {
  if (isPlaybackCommandPending.value || isSeeking.value) return;

  isPlaybackCommandPending.value = true;
  try {
    if (!(await refreshPlaybackStatus(true))) return;
    const status = playbackStatus.value;
    if (
      !status.hasAudio ||
      (!status.isPlaying && status.durationMs > 0 && status.positionMs >= status.durationMs)
    ) {
      await invoke("play", { path: TEMP_AUDIO_PATH });
    } else if (status.isPlaying) {
      await invoke("pause");
    } else {
      await invoke("resume");
    }

    playbackError.value = "";
    await refreshPlaybackStatus(true);
  } catch (error) {
    playbackError.value = `Playback command failed: ${errorMessage(error)}`;
    await refreshPlaybackStatus(true);
  } finally {
    isPlaybackCommandPending.value = false;
  }
}

function handleSeekInput(event: InstanceType<typeof globalThis.Event>) {
  selectedPositionMs.value = Number(
    (event.target as InstanceType<typeof globalThis.HTMLInputElement>).value,
  );
  isSeeking.value = true;
}

async function commitSeek() {
  if (!isSeeking.value || isPlaybackCommandPending.value) return;

  isPlaybackCommandPending.value = true;
  try {
    await invoke("seek_to", { positionMs: selectedPositionMs.value });
    playbackError.value = "";
    await refreshPlaybackStatus(true);
  } catch (error) {
    playbackError.value = `Seek failed: ${errorMessage(error)}`;
    await refreshPlaybackStatus(true);
  } finally {
    isSeeking.value = false;
    selectedPositionMs.value = playbackStatus.value.positionMs;
    isPlaybackCommandPending.value = false;
  }
}

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
  void refreshPlaybackStatus();
  playbackStatusPoll = globalThis.setInterval(
    () => void refreshPlaybackStatus(),
    PLAYBACK_STATUS_POLL_INTERVAL_MS,
  );
});

onUnmounted(() => {
  if (playbackStatusPoll !== null) globalThis.clearInterval(playbackStatusPoll);
  statusRequestVersion += 1;
  volumeLayoutQuery?.removeEventListener("change", updateVolumeLayout);
  globalThis.document.removeEventListener("pointerdown", closeVolumePopoverOnOutsidePointer);
  globalThis.document.removeEventListener("keydown", closeVolumePopoverOnEscape);
});
</script>

<template>
  <footer
    :aria-label="t('播放控制')"
    class="bg-app-surface text-app-muted fixed inset-x-0 bottom-0 z-50 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-1 sm:h-10 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:gap-x-6 sm:px-6 sm:py-0 md:grid-cols-[minmax(10rem,20rem)_minmax(20rem,1fr)_minmax(9.5rem,14rem)] md:gap-x-[clamp(4px,calc(9.459459459vw-68.64864865px),32px)] md:pr-4 md:pl-8"
  >
    <div class="col-start-1 row-start-1 flex min-w-0 items-center gap-4 md:gap-5">
      <div class="flex items-center gap-1">
        <button
          :aria-label="t('上一首')"
          class="text-app-muted focus-visible:outline-app-accent grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="canPlayPrevious ? 'hover:text-white' : 'cursor-not-allowed opacity-50'"
          :disabled="!canPlayPrevious"
          type="button"
          @click="playPreviousTrack"
        >
          <SkipBack aria-hidden="true" class="size-4" />
        </button>
        <button
          :aria-label="displayedIsPlaying ? t('暂停') : t('播放')"
          class="bg-app-accent focus-visible:outline-app-accent grid size-8 place-items-center rounded-full text-black transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
          :class="{ 'opacity-50': !currentTrack && !canStartRestoredQueue }"
          :disabled="
            isPlaybackCommandPending || isSeeking || (!currentTrack && !canStartRestoredQueue)
          "
          type="button"
          @click="togglePlayback"
        >
          <Pause v-if="displayedIsPlaying" aria-hidden="true" class="size-5 fill-current" />
          <Play v-else aria-hidden="true" class="size-5 fill-current" />
        </button>
        <button
          :aria-label="t('下一首')"
          class="text-app-muted focus-visible:outline-app-accent grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="canPlayNext ? 'hover:text-white' : 'cursor-not-allowed opacity-50'"
          :disabled="!canPlayNext"
          type="button"
          @click="playNextTrack"
        >
          <SkipForward aria-hidden="true" class="size-4" />
        </button>
      </div>

      <div ref="volumeControl" class="text-app-muted relative flex shrink-0 items-center gap-3">
        <button
          :aria-label="
            isHorizontalVolumeVisible ? (volume === 0 ? t('取消静音') : t('静音')) : t('音量控制')
          "
          :aria-controls="isHorizontalVolumeVisible ? undefined : 'volume-popover'"
          class="focus-visible:outline-app-accent grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 lg:-mx-2"
          :aria-expanded="isHorizontalVolumeVisible ? undefined : isVolumePopoverOpen"
          :aria-pressed="isHorizontalVolumeVisible ? volume === 0 : undefined"
          type="button"
          @click="handleVolumeButtonClick"
        >
          <VolumeX v-if="volume === 0" aria-hidden="true" class="size-4" />
          <Volume2 v-else aria-hidden="true" class="size-4" />
        </button>
        <div class="bg-app-track relative hidden h-1 w-20 shrink-0 rounded-full lg:block">
          <div class="bg-app-muted h-full rounded-full" :style="{ width: `${volume}%` }" />
          <span
            class="absolute top-1/2 left-1/2 size-2 -translate-y-1/2 rounded-full bg-white"
            :style="{ left: `${volume}%` }"
          />
          <input
            v-model.number="volume"
            :aria-label="t('音量')"
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
          class="bg-app-interactive absolute bottom-full left-1/2 z-10 mb-2 flex h-36 w-10 -translate-x-1/2 items-center justify-center rounded-lg shadow-lg"
        >
          <div class="bg-app-track relative h-28 w-1 rounded-full">
            <div
              class="bg-app-muted absolute inset-x-0 bottom-0 rounded-full"
              :style="{ height: `${volume}%` }"
            />
            <span
              class="absolute left-1/2 size-2 -translate-x-1/2 rounded-full bg-white"
              :style="{ bottom: `${volume}%` }"
            />
            <input
              v-model.number="volume"
              :aria-label="t('音量')"
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
      <div class="flex items-center justify-end text-xs sm:h-5">
        <span class="text-app-muted text-right tabular-nums">
          {{ formatTime(sliderPositionMs) }}/{{ formatTime(playbackStatus.durationMs) }}
        </span>
      </div>
      <span
        class="pointer-events-none absolute top-10 left-1/2 w-max max-w-[calc(100%-8rem)] -translate-x-1/2 truncate text-center text-sm font-bold text-white sm:top-1"
      >
        <template v-if="currentTrack">
          {{ currentTrack.title ?? t("未知曲目") }} - {{ currentTrack.artist ?? t("未知演出者") }}
        </template>
        <template v-else>{{ t("未选择歌曲") }}</template>
      </span>
      <div class="bg-app-track relative mt-1 h-1 rounded-full sm:mb-1">
        <div class="bg-app-accent h-full rounded-full" :style="{ width: `${progressPercent}%` }" />
        <span
          class="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          :style="{ left: `${progressPercent}%` }"
        />
        <input
          :aria-label="t('播放进度')"
          :aria-valuetext="
            t('{position} / {duration}', {
              position: formatTime(sliderPositionMs),
              duration: formatTime(playbackStatus.durationMs),
            })
          "
          class="focus-visible:outline-app-accent absolute top-1/2 left-0 z-10 h-6 w-full -translate-y-1/2 cursor-pointer opacity-0 focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed"
          :disabled="
            !playbackStatus.hasAudio ||
            playbackStatus.durationMs === 0 ||
            (isPlaybackCommandPending && !isSeekInputActive)
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
      :aria-label="t('播放选项')"
      class="text-app-muted col-start-2 row-start-1 flex items-center justify-end gap-2 sm:col-start-3 sm:justify-end"
    >
      <button
        :aria-label="t('单曲循环')"
        class="focus-visible:outline-app-accent grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        :class="repeatOneEnabled ? 'text-app-accent' : 'text-app-muted hover:text-white'"
        :aria-pressed="repeatOneEnabled"
        type="button"
        @click="setRepeatOneEnabled(!repeatOneEnabled)"
      >
        <Repeat1 aria-hidden="true" class="size-4" />
      </button>
      <button
        :aria-label="t('随机播放')"
        class="focus-visible:outline-app-accent grid size-8 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        :class="shuffleEnabled ? 'text-app-accent' : 'text-app-muted hover:text-white'"
        :aria-pressed="shuffleEnabled"
        type="button"
        @click="setShuffleEnabled(!shuffleEnabled)"
      >
        <Shuffle aria-hidden="true" class="size-4" />
      </button>
      <PlaybackSpectrum
        :playback-id="currentPlaybackId"
        :active="playbackStatus.isPlaying && !isPlaybackCommandPending && !isSeeking"
      />
    </div>
  </footer>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { usePlaybackControls } from "@/features/playback/controls/useControls";
import PlaybackSpectrum from "@/features/playback/controls/PlaybackSpectrum.vue";
import { useNotification } from "@/shared/notifications/useNotification";
import { usePlaybackVolume } from "@/features/playback/controls/useVolume";
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

const { volume, volumeError, toggleMute } = usePlaybackVolume();
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
  isPlaybackStatusSettled,
  playbackError,
  isSeeking,
  isSeekInputActive,
  selectedPositionMs,
  currentTrack,
  currentPlaybackId,
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
} = usePlaybackControls();

onUnmounted(() => {
  volumeLayoutQuery?.removeEventListener("change", updateVolumeLayout);
  globalThis.document.removeEventListener("pointerdown", closeVolumePopoverOnOutsidePointer);
  globalThis.document.removeEventListener("keydown", closeVolumePopoverOnEscape);
});

const displayedIsPlaying = ref(playbackStatus.value.isPlaying);
watch(
  [playbackStatus, isPlaybackCommandPending, isPlaybackStatusSettled],
  ([status, pending, settled]) => {
    if (!pending && settled) displayedIsPlaying.value = status.isPlaying;
  },
  { immediate: true },
);

const sliderPositionMs = computed(() =>
  isSeeking.value ? selectedPositionMs.value : playbackStatus.value.positionMs,
);
const playbackFailure = computed(() =>
  [
    ...new Set(
      [
        playbackError.value,
        playbackStartError.value,
        queuePlaybackError.value,
        volumeError.value,
      ].filter(Boolean),
    ),
  ].join("\n"),
);
watch(
  playbackFailure,
  (error) => {
    if (error) logger.warn("playback", "failure_feedback_shown", error);
  },
  { immediate: true },
);
const hasPlaybackFailure = computed(() => Boolean(playbackFailure.value));
useNotification(() => {
  if (!hasPlaybackFailure.value) return null;
  return { type: "error", message: t("播放操作失败，请重试或查看日志"), key: "playback" };
});
const progressPercent = computed(() =>
  playbackStatus.value.durationMs > 0
    ? (sliderPositionMs.value / playbackStatus.value.durationMs) * 100
    : 0,
);
</script>

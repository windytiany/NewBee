<template>
  <div
    aria-label="实时音频频谱"
    class="text-spotify-muted ml-6 flex h-7 w-12 shrink-0 items-end justify-between"
    role="img"
    :title="error || '实时音频频谱 · 40 Hz–16 kHz'"
  >
    <span
      v-for="(level, index) in bands"
      :key="index"
      aria-hidden="true"
      class="text-spotify-muted/30 relative block h-full w-1 bg-[repeating-linear-gradient(to_top,currentColor_0px,currentColor_1px,transparent_1px,transparent_3px)]"
    >
      <span
        class="text-spotify-muted absolute inset-x-0 bottom-0 block bg-[repeating-linear-gradient(to_top,currentColor_0px,currentColor_1px,transparent_1px,transparent_3px)] transition-[height] duration-75 ease-out motion-reduce:transition-none"
        :style="{ height: `${Math.round(level * 9) * 3}px` }"
      ></span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { usePlaybackSpectrum } from "@/playback/useSpectrum";

const props = defineProps<{
  playbackId: number | null;
  active: boolean;
}>();

const { bands, error } = usePlaybackSpectrum(
  () => props.playbackId,
  () => props.active,
);
</script>

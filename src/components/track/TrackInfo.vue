<template>
  <section
    aria-label="曲目信息"
    class="bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto text-white"
  >
    <h2 class="shrink-0 px-3 py-2 text-sm font-medium text-white/90">曲目信息</h2>

    <div v-if="props.details === undefined" class="px-3 pb-3">
      <h1 class="truncate text-lg font-bold">{{ props.track.title }}</h1>
      <p class="text-spotify-muted truncate text-sm">{{ props.track.album }}</p>
      <p class="text-spotify-muted truncate text-sm">{{ props.track.artist }}</p>
      <p class="text-spotify-muted text-sm">{{ props.track.year }}</p>
      <p class="text-spotify-muted mt-1 text-xs leading-relaxed">
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

    <div v-else class="px-3 pb-3">
      <p v-if="props.isLoading" class="text-spotify-muted py-3 text-sm" role="status">
        正在读取曲目信息…
      </p>
      <p v-else-if="props.error" class="py-3 text-sm text-red-300" role="alert">
        {{ props.error }}
      </p>
      <template v-if="props.details">
        <h1 class="truncate text-lg font-bold">{{ props.details.title ?? "未知曲目" }}</h1>
        <p class="text-spotify-muted truncate text-sm">
          {{ props.details.artist ?? "未知艺术家" }}
        </p>
        <p class="text-spotify-muted truncate text-sm">
          {{ props.details.album ?? "未知专辑" }}
        </p>
        <dl class="text-spotify-muted mt-3 space-y-1 text-xs leading-relaxed">
          <div class="flex gap-2">
            <dt class="shrink-0">发行日期</dt>
            <dd class="min-w-0 break-words">{{ props.details.releaseDate ?? "未知" }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="shrink-0">Codec</dt>
            <dd class="min-w-0 break-words">{{ props.details.codec ?? "未知" }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="shrink-0">采样率</dt>
            <dd>{{ formatSampleRate(props.details.sampleRateHz) }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="shrink-0">码率</dt>
            <dd>{{ formatBitrate(props.details.bitrateKbps) }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="shrink-0">声道数</dt>
            <dd>{{ formatChannels(props.details.channels) }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="shrink-0">时长</dt>
            <dd>{{ formatTrackDuration(props.details.durationMs) ?? "未知" }}</dd>
          </div>
        </dl>
      </template>
      <p v-else-if="!props.isLoading && !props.error" class="text-spotify-muted py-3 text-sm">
        {{ props.emptyMessage }}
      </p>

      <div
        v-if="props.details || props.isLoading || props.error"
        :aria-label="`${props.details?.album ?? '专辑'} 封面`"
        class="mt-4 grid aspect-square w-full place-items-center overflow-hidden bg-linear-to-br from-[#182c68] via-[#10142e] to-[#090a12] text-blue-300/70"
        role="img"
      >
        <img
          v-if="props.artworkUrl"
          :src="props.artworkUrl"
          :alt="`${props.details?.album ?? '专辑'} 封面`"
          class="h-full w-full object-contain"
        />
        <Disc3 v-else aria-hidden="true" class="size-20" stroke-width="1" />
      </div>
      <p v-if="props.artworkError" class="text-spotify-muted mt-2 text-xs" role="status">
        {{ props.artworkError }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Disc3 } from "@lucide/vue";
import type { TrackDetails } from "../../types/library";
import { formatTrackDuration } from "./formatTrackDuration.ts";

type TrackInfoData = {
  title: string;
  artist: string;
  album: string;
  year: number | string;
  codecInfo: string;
  duration: string;
};

const props = withDefaults(
  defineProps<{
    track?: TrackInfoData;
    details?: TrackDetails | null;
    isLoading?: boolean;
    error?: string;
    artworkUrl?: string | null;
    artworkError?: string;
    emptyMessage?: string;
  }>(),
  {
    track: () => ({
      title: "moonscape",
      artist: "fade",
      album: "last little while",
      year: 2016,
      codecInfo: "FLAC 44.1 kHz, 844k, 立体声",
      duration: "4:52",
    }),
    details: undefined,
    isLoading: false,
    error: "",
    artworkUrl: null,
    artworkError: "",
    emptyMessage: "选择曲目以查看详情和封面。",
  },
);

function formatSampleRate(sampleRateHz: number | null) {
  if (sampleRateHz === null || !Number.isFinite(sampleRateHz)) {
    return "未知";
  }

  const sampleRateKHz = sampleRateHz / 1000;
  return `${Number.isInteger(sampleRateKHz) ? sampleRateKHz : Number(sampleRateKHz.toFixed(3))} kHz`;
}

function formatBitrate(bitrateKbps: number | null) {
  if (bitrateKbps === null || !Number.isFinite(bitrateKbps)) {
    return "未知";
  }

  return `${bitrateKbps} kbps`;
}

function formatChannels(channels: number | null) {
  if (channels === null || !Number.isFinite(channels)) {
    return "未知";
  }

  return `${channels} 声道`;
}
</script>

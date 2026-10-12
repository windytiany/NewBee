<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { formatTrackDuration } from "@/features/library/format";
defineProps<{
  track: {
    title: string | null;
    artist: string | null;
    album: string | null;
    durationMs: number | null;
  };
  current: boolean;
}>();
</script>

<template>
  <span class="flex min-w-0 flex-col gap-0.5">
    <span class="truncate font-medium" :class="current ? 'text-app-accent' : 'text-white'">
      {{ track.title ?? t("未知曲目") }}
    </span>
    <span class="text-app-muted truncate text-xs">{{ track.artist ?? t("未知艺术家") }}</span>
  </span>
  <span class="text-app-muted hidden truncate text-xs sm:block">{{
    track.album ?? t("未知专辑")
  }}</span>
  <slot name="before-duration" />
  <span class="text-app-muted text-right text-xs tabular-nums">{{
    formatTrackDuration(track.durationMs) ?? t("时长未知")
  }}</span>
</template>

<template>
  <section
    aria-label="曲目信息"
    class="bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto text-white"
  >
    <h2 class="shrink-0 px-1 py-2 text-sm font-medium text-white/90">曲目信息</h2>

    <div class="px-1 pb-3">
      <p v-if="isLoading" class="text-spotify-muted py-3 text-sm" role="status">
        正在读取曲目信息…
      </p>
      <p v-else-if="currentTrackDetailsError" class="py-3 text-sm text-red-300" role="alert">
        {{ currentTrackDetailsError }}
      </p>
      <template v-if="currentTrackDetails">
        <h1 class="truncate text-sm font-semibold">
          {{ currentTrackDetails.title ?? "未知曲目" }}
        </h1>
        <p class="text-spotify-muted truncate text-sm">
          {{ currentTrackDetails.artist ?? "未知艺术家" }}
        </p>
        <p class="text-spotify-muted truncate text-sm">
          {{ currentTrackDetails.album ?? "未知专辑" }}
        </p>
        <p v-if="currentTrackDetails.releaseDate" class="text-spotify-muted truncate text-sm">
          {{ currentTrackDetails.releaseDate }}
        </p>
        <p class="text-spotify-muted mt-1 text-xs leading-4">
          {{ formatAudioSummary(currentTrackDetails) }}
        </p>
      </template>
      <p
        v-else-if="!isLoading && !currentTrackDetailsError"
        class="text-spotify-muted py-3 text-sm"
      >
        开始播放后显示当前曲目信息和封面。
      </p>

      <div
        v-if="currentTrackDetails || isLoading || currentTrackDetailsError"
        :aria-label="`${currentTrackDetails?.album ?? '专辑'} 封面`"
        class="mt-3 grid aspect-square w-full place-items-center overflow-hidden bg-linear-to-br from-[#182c68] via-[#10142e] to-[#090a12] text-blue-300/70"
        role="img"
      >
        <img
          v-if="currentTrackArtworkUrl"
          :src="currentTrackArtworkUrl"
          :alt="`${currentTrackDetails?.album ?? '专辑'} 封面`"
          class="h-full w-full object-cover"
        />
        <Disc3 v-else aria-hidden="true" class="size-20" stroke-width="1" />
      </div>
      <p v-if="currentTrackArtworkError" class="text-spotify-muted mt-2 text-xs" role="status">
        {{ currentTrackArtworkError }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Disc3 } from "@lucide/vue";
import { usePlaybackSession } from "@/playback/session";
import { useTrackInfo } from "@/playback/useTrackInfo";
import { formatAudioSummary } from "@/utils/formatTrack.ts";

const { currentTrack } = usePlaybackSession().state;
const {
  currentTrackDetails,
  currentTrackArtworkUrl,
  isLoading,
  currentTrackDetailsError,
  currentTrackArtworkError,
} = useTrackInfo(() => currentTrack.value?.trackId ?? null);
</script>

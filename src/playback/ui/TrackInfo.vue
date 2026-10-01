<template>
  <section
    aria-label="曲目信息"
    class="bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto text-white"
  >
    <h2 class="shrink-0 px-1 py-2 text-sm font-medium text-white/90">曲目信息</h2>

    <TransitionNowPlaying
      v-slot="{ track, details, artworkUrl }"
      :track="currentTrack"
      content-class="px-1 pb-3"
    >
      <div v-if="track" class="text-sm">
        <h1 class="min-h-5 truncate font-semibold">
          {{ details?.title ?? track.title ?? "未知曲目" }}
        </h1>
        <p class="text-spotify-muted min-h-5 truncate">
          {{ details?.artist ?? track.artist ?? "未知艺术家" }}
        </p>
        <p class="text-spotify-muted min-h-5 truncate">
          {{ details?.album ?? "未知专辑" }}
        </p>
        <p class="text-spotify-muted min-h-5 truncate">
          {{ details?.releaseDate }}
        </p>
        <p class="text-spotify-muted mt-1 min-h-4 truncate text-xs leading-4">
          {{ details ? formatAudioSummary(details) : "" }}
        </p>
      </div>
      <p v-else class="text-spotify-muted py-3 text-sm">开始播放后显示当前曲目信息和封面。</p>

      <div
        v-if="track"
        :aria-label="artworkUrl ? undefined : '专辑封面占位图'"
        :role="artworkUrl ? undefined : 'img'"
        class="mt-3 grid aspect-square w-full place-items-center overflow-hidden bg-linear-to-br from-[#182c68] via-[#10142e] to-[#090a12] text-blue-300/70"
      >
        <img
          v-if="artworkUrl"
          :src="artworkUrl"
          :alt="`${details?.album ?? '专辑'} 封面`"
          class="h-full w-full object-cover"
        />
        <Disc3 v-else aria-hidden="true" class="size-20" stroke-width="1" />
      </div>
    </TransitionNowPlaying>
  </section>
</template>

<script setup lang="ts">
import { Disc3 } from "@lucide/vue";
import { usePlaybackSession } from "@/playback/session";
import TransitionNowPlaying from "@/playback/ui/TransitionNowPlaying.vue";
import { formatAudioSummary } from "@/utils/formatTrack.ts";

const { currentTrack } = usePlaybackSession().state;
</script>

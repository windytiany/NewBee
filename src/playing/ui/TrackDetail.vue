<template>
  <article
    aria-label="Track details"
    class="w-full"
    :class="
      props.horizontal
        ? 'grid max-w-5xl grid-cols-2 items-center gap-6 text-left sm:gap-10'
        : props.compact
          ? 'flex max-w-xs flex-col items-center gap-4 text-center'
          : 'flex max-w-sm flex-col items-center gap-6 text-center'
    "
  >
    <div class="w-full" :class="props.horizontal ? 'max-w-md justify-self-center' : ''">
      <div
        class="from-spotify-interactive to-spotify-surface grid aspect-square w-full place-items-center rounded-xl bg-linear-to-br via-[#303030] shadow-2xl"
        :aria-label="currentTrackArtworkUrl ? undefined : '专辑封面占位图'"
        :role="currentTrackArtworkUrl ? undefined : 'img'"
      >
        <img
          v-if="currentTrackArtworkUrl"
          :src="currentTrackArtworkUrl"
          :alt="artworkAlt"
          class="h-full w-full rounded-xl object-cover"
        />
        <DiscAlbum
          v-else
          aria-hidden="true"
          class="text-spotify-muted/80"
          :class="props.horizontal ? 'size-32 sm:size-40' : 'size-24'"
          stroke-width="1.25"
        />
      </div>
      <p v-if="currentTrackArtworkError" class="text-spotify-muted mt-2 text-xs" role="status">
        {{ currentTrackArtworkError }}
      </p>
    </div>

    <div
      class="flex flex-col"
      :class="props.horizontal ? 'items-start gap-3' : 'items-center gap-1'"
    >
      <h1
        class="font-bold tracking-tight"
        :class="
          props.horizontal
            ? 'text-4xl sm:text-5xl lg:text-6xl'
            : props.compact
              ? 'text-2xl'
              : 'text-3xl sm:text-4xl'
        "
      >
        {{ currentTrack ? trackTitle : "未选择歌曲" }}
      </h1>
      <p
        v-if="currentTrack"
        class="text-spotify-muted"
        :class="props.horizontal ? 'text-xl sm:text-2xl' : props.compact ? 'text-sm' : 'text-base'"
      >
        {{ trackArtist }}
      </p>
      <p v-else class="text-spotify-muted text-sm" role="status">当前没有播放曲目。</p>
      <p
        v-if="currentTrack"
        :class="
          props.horizontal
            ? 'text-spotify-muted/70 text-lg sm:text-xl'
            : 'text-spotify-muted/70 text-sm'
        "
      >
        {{ albumName }}
      </p>
      <p v-if="currentTrack && isLoading" class="text-spotify-muted text-sm" role="status">
        正在读取曲目信息…
      </p>
      <p
        v-else-if="currentTrack && currentTrackDetailsError"
        class="text-sm text-red-300"
        role="alert"
      >
        {{ currentTrackDetailsError }}
      </p>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { DiscAlbum } from "@lucide/vue";
import { usePlaybackSession } from "@/playback/session";
import { useTrackInfo } from "@/playback/useTrackInfo";

const props = withDefaults(defineProps<{ compact?: boolean; horizontal?: boolean }>(), {
  compact: false,
  horizontal: false,
});

const { currentTrack } = usePlaybackSession().state;
const {
  currentTrackDetails,
  currentTrackArtworkUrl,
  isLoading,
  currentTrackDetailsError,
  currentTrackArtworkError,
} = useTrackInfo(() => currentTrack.value?.trackId ?? null);
const trackTitle = computed(
  () => currentTrackDetails.value?.title ?? currentTrack.value?.title ?? "未知曲目",
);
const trackArtist = computed(
  () => currentTrackDetails.value?.artist ?? currentTrack.value?.artist ?? "未知艺术家",
);
const albumName = computed(
  () => currentTrackDetails.value?.album ?? (isLoading.value ? "正在读取专辑信息…" : "未知专辑"),
);
const artworkAlt = computed(() => {
  const album = currentTrackDetails.value?.album;
  return album ? `${album} 封面` : "专辑封面";
});
</script>

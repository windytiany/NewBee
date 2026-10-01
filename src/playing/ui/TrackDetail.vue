<template>
  <article
    aria-label="Track details"
    class="w-full"
    :class="
      props.horizontal
        ? 'max-w-5xl'
        : props.compact
          ? 'max-w-xl min-w-0 md:h-full md:min-h-0'
          : 'max-w-sm'
    "
  >
    <TransitionNowPlaying
      v-slot="{ track, details, artworkUrl }"
      :track="currentTrack"
      :class="{ 'md:h-full md:min-h-0': props.compact && !props.horizontal }"
      :content-class="
        props.horizontal
          ? 'grid grid-cols-2 items-center gap-6 text-left sm:gap-10'
          : props.compact
            ? 'flex flex-col items-start gap-5 text-left sm:gap-6 md:grid md:h-full md:min-h-0 md:grid-rows-[minmax(0,1fr)_auto]'
            : 'flex flex-col items-center gap-6 text-center'
      "
    >
      <div
        class="w-full"
        :class="
          props.horizontal
            ? 'max-w-md justify-self-center'
            : props.compact
              ? 'md:[container-type:size] md:h-full md:min-h-0'
              : ''
        "
      >
        <div
          class="from-spotify-interactive to-spotify-surface grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-linear-to-br via-[#303030] shadow-2xl"
          :class="{ 'md:w-[min(100cqw,100cqh)]': props.compact && !props.horizontal }"
          :aria-label="artworkUrl ? undefined : '专辑封面占位图'"
          :role="artworkUrl ? undefined : 'img'"
        >
          <img
            v-if="artworkUrl"
            :src="artworkUrl"
            :alt="details?.album ? `${details.album} 封面` : '专辑封面'"
            class="h-full w-full object-cover"
          />
          <DiscAlbum
            v-else
            aria-hidden="true"
            class="text-spotify-muted/80"
            :class="props.horizontal ? 'size-32 sm:size-40' : 'size-24'"
            stroke-width="1.25"
          />
        </div>
      </div>

      <div
        class="flex flex-col"
        :class="
          props.horizontal
            ? 'items-start gap-3'
            : props.compact
              ? 'w-full items-start gap-2'
              : 'items-center gap-1'
        "
      >
        <h1
          class="font-bold tracking-tight"
          :class="
            props.horizontal
              ? 'text-4xl sm:text-5xl lg:text-6xl'
              : props.compact
                ? 'text-3xl lg:text-4xl'
                : 'text-3xl sm:text-4xl'
          "
        >
          {{ track ? (details?.title ?? track.title ?? "未知曲目") : "未选择歌曲" }}
        </h1>
        <p
          v-if="track"
          class="text-spotify-muted"
          :class="
            props.horizontal
              ? 'text-xl sm:text-2xl'
              : props.compact
                ? 'text-xl lg:text-2xl'
                : 'text-base'
          "
        >
          {{ details?.artist ?? track.artist ?? "未知艺术家" }}
        </p>
        <p v-else class="text-spotify-muted text-sm" role="status">当前没有播放曲目。</p>
        <p
          v-if="track"
          :class="
            props.horizontal
              ? 'text-spotify-muted/70 text-lg sm:text-xl'
              : props.compact
                ? 'text-spotify-muted/70 text-lg lg:text-xl'
                : 'text-spotify-muted/70 text-sm'
          "
        >
          {{ details?.album ?? "未知专辑" }}
        </p>
      </div>
    </TransitionNowPlaying>
  </article>
</template>

<script setup lang="ts">
import { DiscAlbum } from "@lucide/vue";
import { usePlaybackSession } from "@/playback/session";
import TransitionNowPlaying from "@/playback/ui/TransitionNowPlaying.vue";

const props = withDefaults(defineProps<{ compact?: boolean; horizontal?: boolean }>(), {
  compact: false,
  horizontal: false,
});

const { currentTrack } = usePlaybackSession().state;
</script>

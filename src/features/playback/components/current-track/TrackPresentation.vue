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
    <TrackTransition
      v-slot="{ track, details, artworkUrl, artworkStatus }"
      :track="currentTrack"
      :artwork-size="artworkSize"
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
              ? 'md:@container-size md:h-full md:min-h-0'
              : ''
        "
      >
        <div
          ref="coverElement"
          class="from-app-interactive to-app-surface via-app-highlight grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-linear-to-br shadow-2xl"
          :class="{ 'md:w-[min(100cqw,100cqh)]': props.compact && !props.horizontal }"
          :aria-label="artworkStatus === 'fallback' ? '专辑封面占位图' : undefined"
          :role="artworkStatus === 'fallback' ? 'img' : undefined"
        >
          <img
            v-if="artworkUrl"
            :src="artworkUrl"
            :alt="details?.album ? `${details.album} 封面` : '专辑封面'"
            class="h-full w-full object-cover"
          />
          <DiscAlbum
            v-else-if="artworkStatus === 'fallback'"
            aria-hidden="true"
            class="text-app-muted/80"
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
          class="text-app-muted"
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
        <p
          v-if="track"
          :class="
            props.horizontal
              ? 'text-app-muted/70 text-lg sm:text-xl'
              : props.compact
                ? 'text-app-muted/70 text-lg lg:text-xl'
                : 'text-app-muted/70 text-sm'
          "
        >
          {{ details?.album ?? "未知专辑" }}
        </p>
      </div>
    </TrackTransition>
  </article>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useArtworkSize } from "@/features/artwork/useArtworkSize";
import { DiscAlbum } from "@lucide/vue";
import { usePlaybackSession } from "@/features/playback/session";
import TrackTransition from "@/features/playback/components/current-track/TrackTransition.vue";

const props = withDefaults(defineProps<{ compact?: boolean; horizontal?: boolean }>(), {
  compact: false,
  horizontal: false,
});

const coverElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const artworkSize = useArtworkSize(coverElement);
const { currentTrack } = usePlaybackSession().state;
</script>

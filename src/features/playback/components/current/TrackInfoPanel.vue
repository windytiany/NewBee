<template>
  <section
    v-persistent-scroll="JSON.stringify(['playback', 'details', currentTrack?.trackId])"
    :aria-label="t('曲目信息')"
    class="bg-app-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto text-white"
  >
    <h2 class="shrink-0 px-1 py-2 text-sm font-medium text-white/90">{{ t("曲目信息") }}</h2>

    <TrackTransition
      v-slot="{ track, details, artworkUrl }"
      :track="currentTrack"
      :artwork-size="artworkSize"
      content-class="px-1 pb-3"
    >
      <div v-if="track" class="text-sm">
        <h1 class="min-h-5 truncate font-semibold">
          {{ details?.title ?? track.title ?? t("未知曲目") }}
        </h1>
        <p class="text-app-muted min-h-5 truncate">
          {{ details?.artist ?? track.artist ?? t("未知艺术家") }}
        </p>
        <p class="text-app-muted min-h-5 truncate">
          {{ details?.album ?? t("未知专辑") }}
        </p>
        <p class="text-app-muted min-h-5 truncate">
          {{ details?.releaseDate }}
        </p>
        <p class="text-app-muted mt-1 min-h-4 truncate text-xs leading-4">
          {{ details ? formatAudioSummary(details) : "" }}
        </p>
      </div>
      <p v-else class="text-app-muted py-3 text-sm">{{ t("未播放") }}</p>

      <div
        v-if="track"
        ref="coverElement"
        :aria-label="artworkUrl ? undefined : t('专辑封面占位图')"
        :role="artworkUrl ? undefined : 'img'"
        class="from-app-header via-app-header-middle to-app-surface text-app-accent/70 mt-3 grid aspect-square w-full place-items-center overflow-hidden bg-linear-to-br"
      >
        <img
          v-if="artworkUrl"
          :src="artworkUrl"
          :alt="details?.album ? t('{album} 封面', { album: details.album }) : t('专辑封面')"
          class="h-full w-full object-cover"
        />
        <Disc3 v-else aria-hidden="true" class="size-20" stroke-width="1" />
      </div>
    </TrackTransition>
  </section>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { ref } from "vue";
import { vPersistentScroll } from "@/shared/interaction/scroll/persistence";
import { useArtworkSize } from "@/features/artwork/useArtworkSize";
import { Disc3 } from "@lucide/vue";
import { usePlaybackSession } from "@/features/playback/session";
import TrackTransition from "@/features/playback/components/current/TrackTransition.vue";
import { formatAudioSummary } from "@/features/library/format";

const coverElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const artworkSize = useArtworkSize(coverElement);
const { currentTrack } = usePlaybackSession().state;
</script>

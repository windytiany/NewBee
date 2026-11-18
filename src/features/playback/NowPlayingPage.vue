<template>
  <section
    data-focus-region
    :aria-label="t('正在播放')"
    class="relative isolate grid h-full min-h-0 w-full min-w-0 place-items-center text-white"
    :class="displayedBackground ? '[--app-muted:var(--app-cover-muted)]' : ''"
  >
    <!-- The outgoing layer stays opaque until the incoming background covers it. -->
    <Transition
      enter-active-class="transition-opacity duration-300 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-300 ease-out motion-reduce:transition-none"
      leave-from-class="opacity-100"
      :leave-to-class="displayedBackground ? 'opacity-100' : 'opacity-0'"
    >
      <div
        v-if="displayedBackground"
        :key="displayedBackground.imageUrl"
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 bg-cover"
        :style="backgroundStyle"
      ></div>
    </Transition>
    <div
      class="playing-layout relative flex h-full min-h-0 w-full max-w-352 flex-col items-center justify-center gap-8 px-6 md:@container-size md:w-[88%] md:px-0"
      :class="
        presentation === 'both'
          ? 'md:grid md:grid-cols-2 md:grid-rows-[minmax(0,1fr)] md:gap-(--track-lyrics-gap)'
          : ''
      "
    >
      <button
        :aria-label="t(nextModeLabel[presentation])"
        class="top-16"
        :class="viewButtonClass"
        :title="t(nextModeLabel[presentation])"
        type="button"
        @click="cyclePresentation"
      >
        <component :is="nextModeIcon[presentation]" aria-hidden="true" class="size-5" />
      </button>

      <!-- Keep the cover laid out at its Both size while browsing lyrics. -->
      <TrackPresentation
        :compact="presentation !== 'track'"
        :class="{
          'md:py-12': presentation !== 'track',
          'invisible absolute inset-y-0 max-md:inset-x-6 max-md:w-auto md:start-0 md:w-(--both-track-column)':
            presentation === 'lyrics',
        }"
        :horizontal="presentation === 'track'"
      />
      <div
        v-show="presentation !== 'track'"
        class="h-full min-h-0 w-full min-w-0 flex-1"
        :class="{ 'combined-lyrics md:w-auto': presentation === 'both' }"
      >
        <p v-if="lyricsState.status === 'idle'" class="text-app-muted py-8 text-center text-lg">
          {{ t("未选择歌曲") }}
        </p>
        <LyricsView
          v-show="lyricsState.status === 'ready' && presentation !== 'track'"
          :compact="presentation === 'both'"
          :lyrics="trackLyrics"
          :active-index="activeIndex"
          :active-group-start-index="activeGroupStartIndex"
          :can-seek="canSeek"
          :track-id="currentTrack?.trackId ?? null"
          :visible="presentation !== 'track' && lyricsState.status === 'ready'"
          :is-seeking="isSeeking"
          @seek="handleLyricsSeek"
        >
          <template #controls="{ returnToCurrentLyric }">
            <button
              type="button"
              tabindex="-1"
              :aria-label="t('恢复歌词跟随')"
              :title="t('恢复歌词跟随')"
              class="bottom-24 sm:bottom-[calc(var(--app-playback-bar-height)+1rem)]"
              :class="viewButtonClass"
              @click="returnToCurrentLyric"
            >
              <RefreshCw aria-hidden="true" class="size-5" />
            </button>
          </template>
        </LyricsView>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, shallowRef, watch } from "vue";
import { Columns2, DiscAlbum, ListMusic, RefreshCw } from "@lucide/vue";
import { usePlaybackSession } from "@/features/playback/session";
import { ALBUM_BACKGROUND_SAMPLE_SIZE } from "@/features/artwork/background";
import type { AlbumBackground } from "@/features/artwork/background";
import { useTrackArtwork } from "@/features/artwork/track/useArtwork";
import { useCoverBackground } from "@/features/settings/appearance/useCoverBackground";
import LyricsView from "@/features/lyrics/LyricsView.vue";
import TrackPresentation from "@/features/playback/current/TrackPresentation.vue";
import { canSeekLyrics, seekToLyric } from "@/features/lyrics/seek";
import { useLyrics } from "@/features/lyrics/useLyrics";
import { usePlaybackLyrics } from "@/features/lyrics/useSidecar";
import {
  useDisplayMode,
  type PlaybackDisplayMode as Presentation,
} from "@/features/playback/current/useDisplayMode";

const { presentation } = useDisplayMode();
const viewButtonClass =
  "bg-app-interactive text-app-muted focus-visible:outline-app-accent hover:bg-app-highlight fixed right-4 z-40 grid size-10 place-items-center rounded-full shadow-lg transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 sm:right-6";
const session = usePlaybackSession();
const { currentTrack, playbackStatus, isSeeking } = session.state;
const playingCoverBackground = useCoverBackground("playingCoverBackground");
const { background, status: backgroundStatus } = useTrackArtwork(
  () => (playingCoverBackground.value ? (currentTrack.value?.trackId ?? null) : null),
  ALBUM_BACKGROUND_SAMPLE_SIZE,
  "background",
);
const displayedBackground = shallowRef<AlbumBackground | null>(null);
watch(
  [background, backgroundStatus, playingCoverBackground, () => currentTrack.value?.trackId ?? null],
  ([nextBackground, artworkStatus, enabled, trackId]) => {
    if (!enabled || trackId === null) {
      displayedBackground.value = null;
      return;
    }
    // Keep the previous layer until the next track's background is ready.
    if (artworkStatus === "loading") return;
    displayedBackground.value = nextBackground;
  },
  { immediate: true },
);
const backgroundStyle = computed(() => ({
  backgroundImage: displayedBackground.value
    ? `linear-gradient(var(--app-cover-overlay), var(--app-cover-overlay)), linear-gradient(to bottom, ${displayedBackground.value.color}, transparent 48px), url("${displayedBackground.value.imageUrl}")`
    : undefined,
}));
const {
  state: lyricsState,
  activeIndex,
  activeGroupStartIndex,
} = useLyrics({ currentTrack, playbackStatus, sidecarLyrics: usePlaybackLyrics() });
const canSeek = computed(() => canSeekLyrics(session, lyricsState.value));
const trackLyrics = computed(() =>
  lyricsState.value.status === "ready" ? lyricsState.value.lyrics : { kind: "none" as const },
);
const nextPresentation: Record<Presentation, Presentation> = {
  track: "lyrics",
  lyrics: "both",
  both: "track",
};
const nextModeLabel: Record<Presentation, string> = {
  track: "显示歌词",
  lyrics: "显示曲目和歌词",
  both: "显示曲目详情",
};
const nextModeIcon = {
  track: ListMusic,
  lyrics: Columns2,
  both: DiscAlbum,
};

function cyclePresentation() {
  presentation.value = nextPresentation[presentation.value];
}

async function handleLyricsSeek(startMs: number) {
  const sourceTrackId = currentTrack.value?.trackId ?? currentTrack.value?.path ?? null;
  await seekToLyric(session, lyricsState.value, sourceTrackId, startMs);
}
</script>

<style scoped>
@reference "@/app/styles/main.css";

.playing-layout {
  --track-lyrics-gap: clamp(3rem, 6vw, 7rem);
  --both-track-column: calc((100cqw - var(--track-lyrics-gap)) / 2);
  --both-details-height: 10.5rem;
  --both-cover-side: clamp(
    0px,
    calc(100cqh - 2 * --spacing(12) - var(--both-details-height)),
    min(var(--both-track-column), 36rem)
  );
  --playing-content-gap: 24px;
}

@variant lg {
  .playing-layout {
    --both-details-height: 11.25rem;
  }
}

@variant md {
  .playing-layout {
    /* Match the visible gap after Both reclaims half of its unused column space. */
    --playing-content-gap: calc(
      (var(--both-track-column) + var(--track-lyrics-gap) - var(--both-cover-side)) / 2
    );
  }

  .combined-lyrics {
    margin-inline-start: calc(-1 * var(--playing-content-gap));
  }
}
</style>

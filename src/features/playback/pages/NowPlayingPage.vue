<template>
  <section
    aria-label="Now playing"
    class="relative isolate grid h-full min-h-0 w-full min-w-0 place-items-center"
    :class="background ? '[--app-muted:#e5e7eb] [--app-text:#fff]' : ''"
  >
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 bg-cover transition-opacity duration-200 motion-reduce:transition-none"
      :class="background ? 'opacity-100' : 'opacity-0'"
      :style="backgroundStyle"
    ></div>
    <div
      class="relative flex w-full flex-col items-center justify-center gap-8"
      :class="[
        presentation === 'lyrics'
          ? 'max-w-none px-0 py-8'
          : presentation === 'both'
            ? 'max-w-[88rem] px-6 py-12 md:grid md:h-full md:min-h-0 md:w-[88%] md:grid-cols-2 md:grid-rows-[minmax(0,1fr)] md:gap-[clamp(3rem,6vw,7rem)] md:px-0'
            : 'max-w-6xl px-6 py-8',
      ]"
    >
      <button
        :aria-label="nextModeLabel[presentation]"
        class="bg-app-interactive text-app-muted focus-visible:outline-app-accent hover:bg-app-highlight fixed top-16 right-4 z-40 grid size-10 place-items-center rounded-full shadow-lg transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 sm:right-6"
        :title="nextModeLabel[presentation]"
        type="button"
        @click="cyclePresentation"
      >
        <component :is="nextModeIcon[presentation]" aria-hidden="true" class="size-5" />
      </button>

      <TrackPresentation
        v-if="presentation !== 'lyrics'"
        :compact="presentation === 'both'"
        :horizontal="presentation === 'track'"
      />
      <div
        v-show="presentation !== 'track'"
        class="w-full"
        :class="presentation === 'both' ? 'min-w-0 md:h-full md:min-h-0' : 'max-w-none'"
      >
        <p
          v-if="lyricsState.status === 'idle'"
          class="text-app-muted mx-auto max-w-5xl px-6 py-8 text-center text-lg"
        >
          未选择歌曲
        </p>
        <p v-if="lyricsState.status === 'error'" role="alert" class="px-6 text-sm text-amber-200">
          歌词读取失败 <button type="button" @click="retry">重试</button>
        </p>
        <LyricsView
          v-show="lyricsState.status === 'ready' && presentation !== 'track'"
          class="max-w-none"
          :compact="presentation === 'both'"
          :lyrics="trackLyrics"
          :active-index="activeIndex"
          :active-group-start-index="activeGroupStartIndex"
          :can-seek="canSeek"
          :track-id="currentTrack?.trackId ?? null"
          :visible="presentation !== 'track' && lyricsState.status === 'ready'"
          :is-seeking="isSeeking"
          @seek="handleLyricsSeek"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Columns2, DiscAlbum, ListMusic } from "@lucide/vue";
import { usePlaybackSession } from "@/features/playback/session";
import { useTrackDetails } from "@/features/playback/composables/useTrackDetails";
import { useAlbumArtwork } from "@/features/artwork/useAlbumArtwork";
import { useAlbumBackground } from "@/features/settings/composables/useAlbumBackground";
import LyricsView from "@/features/lyrics/components/LyricsView.vue";
import TrackPresentation from "@/features/playback/components/current-track/TrackPresentation.vue";
import { canSeekLyrics, seekToLyric } from "@/features/lyrics/seek";
import { useLyrics } from "@/features/lyrics/composables/useLyrics";
import {
  useDisplayMode,
  type PlaybackDisplayMode as Presentation,
} from "@/features/playback/composables/useDisplayMode";

const { presentation } = useDisplayMode();
const session = usePlaybackSession();
const { currentTrack, playbackStatus, isSeeking } = session.state;
const albumCoverBackground = useAlbumBackground();
const { currentTrackDetails } = useTrackDetails(() =>
  albumCoverBackground.value ? (currentTrack.value?.trackId ?? null) : null,
);
const { background } = useAlbumArtwork(() => {
  const details = currentTrackDetails.value;
  if (!albumCoverBackground.value || !details || details.id !== currentTrack.value?.trackId)
    return null;
  return { albumArtist: details.albumArtist, album: details.album };
}, "background");
const backgroundStyle = computed(() => ({
  backgroundImage: background.value
    ? `linear-gradient(to bottom, ${background.value.color}, transparent 48px), url("${background.value.imageUrl}")`
    : undefined,
}));
const {
  retry,
  state: lyricsState,
  activeIndex,
  activeGroupStartIndex,
} = useLyrics({ currentTrack, playbackStatus });
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
  track: "Show lyrics",
  lyrics: "Show track and lyrics",
  both: "Show track details",
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
  const sourceTrackId = currentTrack.value?.trackId ?? null;
  await seekToLyric(session, lyricsState.value, sourceTrackId, startMs);
}
</script>

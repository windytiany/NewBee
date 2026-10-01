<template>
  <section
    aria-label="Now playing"
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
      class="bg-spotify-interactive text-spotify-muted focus-visible:outline-spotify-green fixed top-16 right-4 z-40 grid size-10 place-items-center rounded-full shadow-lg transition-colors hover:bg-[#282828] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 sm:right-6"
      :title="nextModeLabel[presentation]"
      type="button"
      @click="cyclePresentation"
    >
      <component :is="nextModeIcon[presentation]" aria-hidden="true" class="size-5" />
    </button>

    <TrackDetail
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
        v-if="lyricsState.status === 'loading'"
        class="text-spotify-muted mx-auto max-w-5xl px-6 py-8 text-center text-lg"
        role="status"
      >
        正在加载歌词…
      </p>
      <p
        v-else-if="lyricsState.status === 'error'"
        class="text-spotify-muted mx-auto max-w-5xl px-6 py-8 text-center text-lg"
        role="alert"
      >
        歌词读取失败：{{ lyricsState.message }}
      </p>
      <p
        v-else-if="lyricsState.status === 'idle'"
        class="text-spotify-muted mx-auto max-w-5xl px-6 py-8 text-center text-lg"
      >
        未选择歌曲
      </p>
      <Lyrics
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
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Columns2, DiscAlbum, ListMusic } from "@lucide/vue";
import { usePlaybackSession } from "@/playback/session";
import Lyrics from "@/playing/ui/Lyrics.vue";
import TrackDetail from "@/playing/ui/TrackDetail.vue";
import { canSeekLyrics, seekToLyric } from "@/playing/seek";
import { usePlayingLyrics } from "@/playing/useLyrics";
import {
  usePersistentPlayingPresentation,
  type PlayingPresentation as Presentation,
} from "@/playing/presentation";

const { presentation } = usePersistentPlayingPresentation();
const session = usePlaybackSession();
const { currentTrack, playbackStatus, isSeeking } = session.state;
const {
  state: lyricsState,
  activeIndex,
  activeGroupStartIndex,
} = usePlayingLyrics({ currentTrack, playbackStatus });
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

<template>
  <div class="relative grid" :aria-busy="!!props.track && (isLoading || status === 'loading')">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="pointer-events-none absolute inset-0 transition-opacity duration-200 ease-out motion-reduce:transition-none"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
      @after-leave="releaseArtwork"
      @leave-cancelled="releaseArtwork"
    >
      <div
        v-if="displayed"
        :key="displayed.key"
        :data-artwork-key="displayed.key"
        class="col-start-1 row-start-1 min-w-0"
        :class="props.contentClass"
      >
        <slot
          :track="displayed.track"
          :details="displayed.details"
          :artwork-url="displayed.artworkUrl"
          :details-error="displayed.detailsError"
          :artwork-error="displayed.artworkError"
        />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { onScopeDispose, shallowRef, watch } from "vue";
import { retainTrackArtwork, useTrackArtwork } from "@/artwork/trackArtwork";
import { useTrackInfo } from "@/playback/useTrackInfo";
import type { NowPlayingTrack } from "@/playback/state";
import type { TrackDetails } from "@/types/track";

type PresentationTrack = Pick<NowPlayingTrack, "trackId" | "title" | "artist">;
type DisplayedTrack = {
  key: number;
  track: PresentationTrack | null;
  details: TrackDetails | null;
  artworkUrl: string | null;
  detailsError: string;
  artworkError: string;
};

const props = defineProps<{ track: PresentationTrack | null; contentClass?: string }>();
const { currentTrackDetails, isLoading, currentTrackDetailsError } = useTrackInfo(
  () => props.track?.trackId ?? null,
);
const { status, url, error } = useTrackArtwork(() => props.track?.trackId ?? null);
const displayed = shallowRef<DisplayedTrack | null>(null);
const retainedArtwork = new Map<number, () => void>();
let nextKey = 0;

function releaseArtwork(element: { getAttribute: (name: string) => string | null }) {
  const key = Number(element.getAttribute("data-artwork-key"));
  retainedArtwork.get(key)?.();
  retainedArtwork.delete(key);
}

watch(
  [() => props.track, currentTrackDetails, isLoading, status, url, currentTrackDetailsError, error],
  ([track, details, detailsLoading, artworkStatus, artworkUrl, detailsError, artworkError]) => {
    if (track && (detailsLoading || artworkStatus === "loading")) return;

    const key = ++nextKey;
    // Keep each snapshot's image alive through its DOM leave animation.
    if (track && artworkUrl) retainedArtwork.set(key, retainTrackArtwork(track.trackId));
    displayed.value = {
      key,
      track: track ? { trackId: track.trackId, title: track.title, artist: track.artist } : null,
      details,
      artworkUrl,
      detailsError,
      artworkError,
    };
  },
  { immediate: true },
);

onScopeDispose(() => {
  for (const release of retainedArtwork.values()) release();
  retainedArtwork.clear();
});
</script>

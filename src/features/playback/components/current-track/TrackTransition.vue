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
        <p v-if="displayed.detailsError" role="alert" class="text-sm text-amber-200">
          {{ displayed.detailsError }} <button type="button" @click="retry">重试</button>
        </p>
        <slot
          :track="displayed.track"
          :details="displayed.details"
          :artwork-url="displayed.artworkUrl"
          :artwork-status="displayed.artworkStatus"
          :details-error="displayed.detailsError"
          :artwork-error="displayed.artworkError"
        />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { onScopeDispose, shallowRef, watch } from "vue";
import {
  isSameTrackArtwork,
  retainTrackArtwork,
  useTrackArtwork,
} from "@/features/artwork/useTrackArtwork";
import type { TrackArtwork } from "@/features/artwork/types";
import type { TrackArtworkStatus } from "@/features/artwork/useTrackArtwork";
import { useTrackDetails } from "@/features/playback/composables/useTrackDetails";
import type { NowPlayingTrack } from "@/features/playback/types";
import type { TrackDetails } from "@/features/library/types";

type PresentationTrack = Pick<NowPlayingTrack, "trackId" | "title" | "artist">;
type DisplayedTrack = {
  key: number;
  track: PresentationTrack | null;
  details: TrackDetails | null;
  artworkUrl: string | null;
  artworkStatus: TrackArtworkStatus;
  artworkContent: TrackArtwork | null;
  detailsError: string;
  artworkError: string;
};

const props = defineProps<{
  track: PresentationTrack | null;
  contentClass?: string;
  artworkSize?: number | null;
}>();
const { currentTrackDetails, isLoading, currentTrackDetailsError, retry } = useTrackDetails(
  () => props.track?.trackId ?? null,
);
const { status, url, content, error } = useTrackArtwork(
  () => props.track?.trackId ?? null,
  () => props.artworkSize ?? null,
);
const displayed = shallowRef<DisplayedTrack | null>(null);
const retainedArtwork = new Map<number, () => void>();
let nextKey = 0;

function releaseArtwork(element: { getAttribute: (name: string) => string | null }) {
  const key = Number(element.getAttribute("data-artwork-key"));
  retainedArtwork.get(key)?.();
  retainedArtwork.delete(key);
}

watch(
  [
    () => props.track,
    currentTrackDetails,
    isLoading,
    status,
    url,
    content,
    currentTrackDetailsError,
    error,
  ],
  ([
    track,
    details,
    detailsLoading,
    artworkStatus,
    artworkUrl,
    artworkContent,
    detailsError,
    artworkError,
  ]) => {
    const loading = !!track && (detailsLoading || artworkStatus === "loading");
    if (loading && displayed.value && displayed.value.artworkStatus !== "loading") return;

    const previous = displayed.value;
    const sameArtwork =
      !loading &&
      previous !== null &&
      previous.artworkStatus === artworkStatus &&
      isSameTrackArtwork(previous.artworkContent, artworkContent);
    const key =
      previous && (previous.artworkStatus === "loading" || sameArtwork) ? previous.key : ++nextKey;
    // Reuse the displayed URL and its retention when only the track information changes.
    // Different artwork stays alive through its DOM leave animation.
    if (!loading && !sameArtwork && track && artworkUrl)
      retainedArtwork.set(key, retainTrackArtwork(track.trackId, props.artworkSize ?? null));
    displayed.value = {
      key,
      track: track ? { trackId: track.trackId, title: track.title, artist: track.artist } : null,
      details,
      artworkUrl: loading ? null : sameArtwork ? previous.artworkUrl : artworkUrl,
      artworkStatus: loading ? "loading" : artworkStatus,
      artworkContent: loading ? null : artworkContent,
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

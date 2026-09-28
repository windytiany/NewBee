import { readonly, ref } from "vue";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";

const displayedTracks = ref<PlaybackDisplayTrack[]>([]);
const readonlyDisplayedTracks = readonly(displayedTracks);

function replaceDisplayedTracks(tracks: readonly PlaybackDisplayTrack[]) {
  displayedTracks.value = tracks.map((track) => ({ ...track }));
}

export function usePlaybackDisplayList() {
  return {
    displayedTracks: readonlyDisplayedTracks,
    replaceDisplayedTracks,
  };
}

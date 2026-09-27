import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";

export type NowPlayingTrack = {
  trackId: number;
  title: string | null;
  artist: string | null;
};

const currentTrack = ref<NowPlayingTrack | null>(null);
const isPlaybackCommandPending = ref(false);
const playbackStartError = ref("");

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

async function playTrack(trackId: number): Promise<boolean> {
  if (isPlaybackCommandPending.value) return false;

  isPlaybackCommandPending.value = true;
  playbackStartError.value = "";
  try {
    const track = await invoke<NowPlayingTrack>("play_track", { trackId });
    if (track.trackId !== trackId) {
      throw new Error("The returned track does not match the requested track.");
    }

    currentTrack.value = track;
    return true;
  } catch (error) {
    playbackStartError.value = `Playback failed: ${errorMessage(error)}`;
    return false;
  } finally {
    isPlaybackCommandPending.value = false;
  }
}

export function usePlaybackState() {
  return {
    currentTrack,
    isPlaybackCommandPending,
    playbackStartError,
    playTrack,
  };
}

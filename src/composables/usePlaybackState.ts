import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";

export type NowPlayingTrack = {
  trackId: number;
  title: string | null;
  artist: string | null;
};

const CURRENT_TRACK_STORAGE_KEY = "newbee.current-track";

function loadCurrentTrack(): NowPlayingTrack | null {
  try {
    const serializedTrack = globalThis.localStorage.getItem(CURRENT_TRACK_STORAGE_KEY);
    if (serializedTrack === null) return null;

    const parsedTrack: unknown = JSON.parse(serializedTrack);
    if (typeof parsedTrack !== "object" || parsedTrack === null || Array.isArray(parsedTrack)) {
      globalThis.console.error("Saved current track has an invalid format; ignoring it.");
      return null;
    }

    const storedTrack = parsedTrack as Record<string, unknown>;
    if (
      typeof storedTrack.trackId !== "number" ||
      !Number.isSafeInteger(storedTrack.trackId) ||
      (storedTrack.title !== null && typeof storedTrack.title !== "string") ||
      (storedTrack.artist !== null && typeof storedTrack.artist !== "string")
    ) {
      globalThis.console.error("Saved current track is invalid; ignoring it.");
      return null;
    }

    return {
      trackId: storedTrack.trackId,
      title: storedTrack.title,
      artist: storedTrack.artist,
    };
  } catch (error) {
    globalThis.console.error("Could not read saved current track; using no current track.", error);
    return null;
  }
}

function saveCurrentTrack(track: NowPlayingTrack) {
  try {
    globalThis.localStorage.setItem(CURRENT_TRACK_STORAGE_KEY, JSON.stringify(track));
  } catch (error) {
    globalThis.console.error("Could not save current track.", error);
  }
}

const currentTrack = ref<NowPlayingTrack | null>(loadCurrentTrack());
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
    saveCurrentTrack(track);
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

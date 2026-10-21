import type { Ref } from "vue";
import type { PlaybackStatus } from "@/features/playback/types";
import type { LyricsState } from "@/features/lyrics/useLyrics";

export type LyricsSeekSession = {
  state: {
    currentTrack: Readonly<Ref<Readonly<{ trackId: number | null; path?: string }> | null>>;
    playbackStatus: Readonly<Ref<PlaybackStatus>>;
    isPlaybackCommandPending: Readonly<Ref<boolean>>;
    isSeeking: Readonly<Ref<boolean>>;
  };
  beginSeeking: () => void;
  seekTo: (positionMs: number) => Promise<boolean>;
};

function hasSeekablePlayback(session: LyricsSeekSession) {
  const { state } = session;
  return (
    state.currentTrack.value !== null &&
    state.playbackStatus.value.hasAudio &&
    !state.isPlaybackCommandPending.value &&
    !state.isSeeking.value
  );
}

export function canSeekLyrics(session: LyricsSeekSession, lyricsState: LyricsState) {
  return (
    lyricsState.status === "ready" &&
    lyricsState.lyrics.kind === "synced" &&
    hasSeekablePlayback(session)
  );
}

export async function seekToLyric(
  session: LyricsSeekSession,
  lyricsState: LyricsState,
  sourceTrackId: number | string | null,
  startMs: number,
): Promise<boolean> {
  if (!canSeekLyrics(session, lyricsState)) return false;

  const currentTrack = session.state.currentTrack.value;
  if (
    currentTrack === null ||
    sourceTrackId !== (currentTrack.trackId ?? currentTrack.path ?? null)
  )
    return false;
  if (!Number.isFinite(startMs) || startMs < 0) return false;
  if (lyricsState.status !== "ready" || lyricsState.lyrics.kind !== "synced") return false;
  if (!lyricsState.lyrics.lines.some((line) => line.startMs === startMs)) return false;

  const durationMs = session.state.playbackStatus.value.durationMs;
  if (Number.isFinite(durationMs) && durationMs > 0 && startMs > durationMs) return false;

  session.beginSeeking();
  return session.seekTo(startMs);
}

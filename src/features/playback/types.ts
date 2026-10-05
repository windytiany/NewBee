export type NowPlayingTrack = {
  trackId: number;
  title: string | null;
  artist: string | null;
  playbackId: number | null;
};

export type PlaybackTransition = NowPlayingTrack & {
  playbackId: number;
  rowKey: string;
  previousPlaybackId: number;
};

export type PlaybackStartFailure = {
  kind: "audio-file-not-found" | "playback-failed";
  message: string;
};

export type PlaybackCommandInvoker = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type PlaybackStatus = {
  hasAudio: boolean;
  isPlaying: boolean;
  hasEnded: boolean;
  positionMs: number;
  durationMs: number;
};

export type PlaybackDisplayTrack = {
  trackId: number;
  rowKey: string;
  title: string | null;
  album: string | null;
  durationMs: number | null;
};

export type TrackMetadataUpdate = {
  id: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
};

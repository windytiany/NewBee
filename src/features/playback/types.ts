export type PlaybackTrack = {
  trackId: number | null;
  path?: string;
  title: string | null;
  artist: string | null;
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
  trackId: number | null;
  path?: string;
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

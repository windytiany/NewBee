export type PlaylistTrackSummary = {
  playlistItemId: number;
  trackId: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
};

export type PlaylistSummary = {
  id: number;
  name: string;
  trackCount: number;
  coverTrackId: number | null;
};

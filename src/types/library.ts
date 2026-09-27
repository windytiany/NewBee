export type AlbumArtistSummary = {
  albumArtist: string | null;
  albumCount: number;
};

export type AlbumSummary = {
  album: string | null;
  trackCount: number;
};

export type TrackSummary = {
  id: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
};

export type LibraryAlbumSelection = {
  albumArtist: string | null;
  album: string | null;
};

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

export type TrackDetails = {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  releaseDate: string | null;
  discNumber: number | null;
  trackNumber: number | null;
  durationMs: number | null;
  codec: string | null;
  sampleRateHz: number | null;
  bitrateKbps: number | null;
  channels: number | null;
};

export type TrackArtwork =
  { status: "available"; mimeType: string; data: number[] } | { status: "noArtwork" };

export type LibraryAlbumSelection = {
  albumArtist: string | null;
  album: string | null;
};

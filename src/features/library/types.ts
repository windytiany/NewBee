export type LibraryGrouping = "albumArtist" | "artist";

export type LibraryGroup = {
  grouping: LibraryGrouping;
  artist: string | null;
};

export type ArtistSummary = {
  artist: string | null;
  albumCount: number;
};

export type AlbumSummary = {
  albumArtist: string | null;
  album: string | null;
  year: number | null;
};

export type TrackSummary = {
  discNumber: number | null;
  trackNumber: number | null;
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
  discTotal: number | null;
  trackTotal: number | null;
  durationMs: number | null;
  codec: string | null;
  sampleRateHz: number | null;
  bitrateKbps: number | null;
  channels: number | null;
};

export type IngestResult = {
  added: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type LibraryAlbumSelection = {
  albumArtist: string | null;
  album: string | null;
  group?: LibraryGroup;
};

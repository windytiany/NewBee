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

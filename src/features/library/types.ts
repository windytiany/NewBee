import type { ArtistGrouping } from "@/features/artists/types";

export type LibraryGroup = {
  grouping: ArtistGrouping;
  artist: string | null;
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

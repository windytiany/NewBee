import type { Track } from "@/types/track.ts";

export type Album = {
  id: string;
  title: string;
  artist: string;
  year: number;
  tracks: Track[];
};

export type AlbumArtistSummary = {
  albumArtist: string | null;
  albumCount: number;
};

export type AlbumSummary = {
  album: string | null;
  trackCount: number;
};

export type LibraryAlbumSelection = {
  albumArtist: string | null;
  album: string | null;
};

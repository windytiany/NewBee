export type Artist = {
  name: string;
  albumCount: number;
};

export type AlbumArtistSummary = {
  albumArtist: string | null;
  albumCount: number;
};

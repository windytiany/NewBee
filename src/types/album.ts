export type ArtistSelection = {
  name: string;
  albumCount: number;
};

export type AlbumTrack = {
  id: string;
  title: string;
  duration: string;
};

export type Album = {
  id: string;
  title: string;
  artist: string;
  year: number;
  tracks: AlbumTrack[];
};

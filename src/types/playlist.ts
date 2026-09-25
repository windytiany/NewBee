export type PlaylistTrackData = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
};

export type Playlist = {
  id: string;
  name: string;
  tracks: PlaylistTrackData[];
};

export type PlaylistTrackSummary = {
  playlistItemId: number;
  trackId: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
};

/** Serialized rejection from the reorder_playlist_items command. */
export type PlaylistReorderError = {
  code: "item_set_mismatch" | "failed";
  message: string;
};

export type PlaylistSummary = {
  id: number;
  name: string;
  trackCount: number;
  coverTrackId: number | null;
};

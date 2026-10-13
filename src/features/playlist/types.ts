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

/** Read-only playlist catalog; the playlist feature owns its refresh lifecycle. */
export type PlaylistCatalog = {
  readonly playlists: readonly PlaylistSummary[];
  readonly isLoadingPlaylists: boolean;
  readonly playlistsError: string;
  refresh: () => Promise<void>;
};

export type PlaylistSummary = {
  id: number;
  name: string;
  trackCount: number;
  coverTrackId: number | null;
};

export type PlaylistAppendResult = {
  index: number;
  trackId: number;
} & ({ status: "added"; playlistItemId: number } | { status: "failed"; error: string });

import { invoke } from "@tauri-apps/api/core";
import type {
  AlbumArtistSummary,
  AlbumSummary,
  TrackDetails,
  TrackSummary,
  LibraryAlbumSelection,
} from "@/features/library/types";

export type LibraryInvoker = typeof invoke;

export function createLibraryApi(invokeCommand: LibraryInvoker = invoke) {
  return {
    listArtists: () => invokeCommand<AlbumArtistSummary[]>("list_album_artists"),
    listAlbums: (albumArtist: string | null) =>
      invokeCommand<AlbumSummary[]>("list_albums", { albumArtist }),
    listAlbumTracks: (album: LibraryAlbumSelection) =>
      invokeCommand<TrackSummary[]>("list_album_tracks", album),
    getTrack: (trackId: number) => invokeCommand<TrackDetails | null>("get_track", { trackId }),
    removeTrack: (trackId: number) => invokeCommand<void>("remove_track_from_library", { trackId }),
  };
}

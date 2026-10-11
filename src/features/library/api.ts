import type { QueueTrackRemovalResult } from "@/features/playback/session";
import { invoke } from "@tauri-apps/api/core";
import type {
  ArtistSummary,
  LibraryGrouping,
  LibraryGroup,
  AlbumSummary,
  TrackDetails,
  TrackSummary,
  LibraryAlbumSelection,
} from "@/features/library/types";

export type LibraryInvoker = typeof invoke;

export function createLibraryApi(invokeCommand: LibraryInvoker = invoke) {
  return {
    listArtists: (grouping: LibraryGrouping) =>
      invokeCommand<ArtistSummary[]>("list_artists", { grouping }),
    listAlbums: (group: LibraryGroup) => invokeCommand<AlbumSummary[]>("list_albums", { group }),
    listAlbumTracks: (album: LibraryAlbumSelection) =>
      invokeCommand<TrackSummary[]>("list_album_tracks", album),
    getTrack: (trackId: number) => invokeCommand<TrackDetails | null>("get_track", { trackId }),
    removeTrack: (trackId: number) =>
      invokeCommand<QueueTrackRemovalResult>("remove_track_from_library", { trackId }),
  };
}

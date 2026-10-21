import type { QueueTrackRemovalResult } from "@/features/playback/session";
import { invoke } from "@tauri-apps/api/core";
import type { ArtistSummary, ArtistGrouping } from "@/features/artists/types";
import type { LibraryGroup, AlbumSummary, LibraryAlbumSelection } from "@/features/library/types";
import type { TrackSummary } from "@/features/tracks/types";

export type LibraryInvoker = typeof invoke;

export function createLibraryApi(invokeCommand: LibraryInvoker = invoke) {
  return {
    listExternalTrackIds: (trackIds: readonly number[]) =>
      invokeCommand<number[]>("list_external_track_ids", { trackIds }),
    listArtists: (grouping: ArtistGrouping) =>
      invokeCommand<ArtistSummary[]>("list_artists", { grouping }),
    listAlbums: (group: LibraryGroup) => invokeCommand<AlbumSummary[]>("list_albums", { group }),
    listAlbumTracks: (album: LibraryAlbumSelection) =>
      invokeCommand<TrackSummary[]>("list_album_tracks", album),
    removeTrack: (trackId: number) =>
      invokeCommand<QueueTrackRemovalResult>("remove_track_from_library", { trackId }),
  };
}

import { invoke } from "@tauri-apps/api/core";
import type { PlaylistSummary, PlaylistTrackSummary } from "@/features/playlist/types";

export function createPlaylistApi(invokeCommand: typeof invoke = invoke) {
  return {
    list: () => invokeCommand<PlaylistSummary[]>("list_playlists"),
    listTracks: (playlistId: number) =>
      invokeCommand<PlaylistTrackSummary[]>("list_playlist_tracks", { playlistId }),
    create: (name: string) => invokeCommand<number>("create_playlist", { name }),
    rename: (playlistId: number, name: string) =>
      invokeCommand<void>("rename_playlist", { playlistId, name }),
    remove: (playlistId: number) => invokeCommand<void>("delete_playlist", { playlistId }),
    addTrack: (trackId: number, playlistId: number) =>
      invokeCommand<void>("add_track_to_playlist", { trackId, playlistId }),
    removeItems: (playlistId: number, playlistItemIds: readonly number[]) =>
      invokeCommand<void>("remove_playlist_items", {
        playlistId,
        playlistItemIds: [...playlistItemIds],
      }),
    reorder: (playlistId: number, orderedPlaylistItemIds: readonly number[]) =>
      invokeCommand<void>("reorder_playlist_items", {
        playlistId,
        orderedPlaylistItemIds: [...orderedPlaylistItemIds],
      }),
  };
}

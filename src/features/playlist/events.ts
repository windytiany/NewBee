export const PLAYLIST_CHANGED_EVENT = "newbee:playlist-changed";

export function reportPlaylistChanged(playlistId: number) {
  globalThis.window.dispatchEvent(
    new globalThis.CustomEvent<number>(PLAYLIST_CHANGED_EVENT, { detail: playlistId }),
  );
}

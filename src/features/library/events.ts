import { invalidateAlbumArtworkCache } from "@/features/artwork/useAlbumArtwork";
import { reportTracksChanged } from "@/features/tracks/events";

export const LIBRARY_CHANGED_EVENT = "newbee:library-changed";

/** Import results do not identify updated tracks, so reload all subscribed artwork. */
export function reportLibraryImport(result: { added: number; updated: number }) {
  if (result.added + result.updated === 0) return;
  reportTracksChanged();
  globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT));
}

/** Revoking membership does not change the registered track snapshot. */
export function reportLibraryRemoval(trackIds: readonly number[]) {
  if (trackIds.length === 0) return;
  invalidateAlbumArtworkCache();
  globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT));
}

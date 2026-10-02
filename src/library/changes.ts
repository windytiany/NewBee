import { invalidateTrackArtworkCache } from "@/artwork/trackArtwork";

export const LIBRARY_CHANGED_EVENT = "newbee:library-changed";

/** Import results do not identify updated tracks, so reload all subscribed artwork. */
export function reportLibraryImport(result: { added: number; updated: number }) {
  if (result.added + result.updated === 0) return;
  invalidateTrackArtworkCache();
  globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT));
}

/** Database deletion is a change even when subsequent playback synchronization fails. */
export function reportLibraryRemoval(trackIds: readonly number[]) {
  if (trackIds.length === 0) return;
  invalidateTrackArtworkCache(trackIds);
  globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT));
}

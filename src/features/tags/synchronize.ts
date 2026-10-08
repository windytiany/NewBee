import { createLibraryApi } from "@/features/library/api";
import type { LibraryInvoker } from "@/features/library/api";
import type { TrackDetails } from "@/features/library/types";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import { invalidateTrackArtworkCache } from "@/features/artwork/useTrackArtwork";
import { invalidateAlbumArtworkCache } from "@/features/artwork/useAlbumArtwork";
import type { usePlaybackSession } from "@/features/playback/session";

export function createTagSynchronization(
  session: Pick<ReturnType<typeof usePlaybackSession>, "updateTrackMetadata">,
  invokeCommand: LibraryInvoker,
) {
  const library = createLibraryApi(invokeCommand);
  async function tracks(trackIds: number[]) {
    // Any confirmed write can change the artwork snapshot or album association.
    invalidateTrackArtworkCache(trackIds);
    invalidateAlbumArtworkCache();
    globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT));
    const updated = await Promise.all(trackIds.map(library.getTrack));
    session.updateTrackMetadata(updated.filter((track): track is TrackDetails => track !== null));
  }
  return { tracks, artwork: tracks };
}

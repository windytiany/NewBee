import { invalidateAlbumArtworkCache } from "@/features/artwork/useAlbumArtwork";
import { invalidateTrackArtworkCache } from "@/features/artwork/useTrackArtwork";

import type { TrackDetails } from "@/features/tracks/types";

export const TRACKS_CHANGED_EVENT = "newbee:tracks-changed";

export type TracksChange = {
  trackIds: readonly number[] | undefined;
  tracks?: readonly TrackDetails[];
};

/** Undefined IDs mean the operation did not identify its changed snapshots. */
export function reportTracksChanged(
  trackIds?: readonly number[],
  tracks?: readonly TrackDetails[],
) {
  if (trackIds?.length === 0) return;
  invalidateTrackArtworkCache(trackIds);
  invalidateAlbumArtworkCache();
  globalThis.window.dispatchEvent(
    new globalThis.CustomEvent<TracksChange>(TRACKS_CHANGED_EVENT, {
      detail: { trackIds, tracks },
    }),
  );
}

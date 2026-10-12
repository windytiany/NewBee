import { createLibraryApi } from "@/features/library/api";
import type { LibraryInvoker } from "@/features/library/api";
import type { TrackDetails } from "@/features/library/types";
import type { MetadataTarget, EditorTrack } from "@/features/metadata/types";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import { invalidateTrackArtworkCache } from "@/features/artwork/useTrackArtwork";
import { invalidateAlbumArtworkCache } from "@/features/artwork/useAlbumArtwork";
import type { usePlaybackSession } from "@/features/playback/session";

import { FILES_CHANGED_EVENT } from "@/features/metadata/events";

export function createTagSynchronization(
  session: Pick<ReturnType<typeof usePlaybackSession>, "updateTrackMetadata">,
  invokeCommand: LibraryInvoker,
) {
  const library = createLibraryApi(invokeCommand);
  async function tracks(targets: MetadataTarget[]) {
    const trackIds = targets.filter((target): target is number => typeof target === "number");
    const paths = targets.filter((target): target is string => typeof target === "string");
    if (paths.length) {
      invalidateTrackArtworkCache(paths);
      try {
        const updated = await Promise.all(
          paths.map((path) => invokeCommand<EditorTrack>("read_audio_file", { path })),
        );
        await session.updateTrackMetadata(
          updated.map((track) => ({ ...track, id: null, path: track.path })),
        );
      } finally {
        globalThis.window.dispatchEvent(
          new globalThis.CustomEvent(FILES_CHANGED_EVENT, { detail: paths }),
        );
      }
    }
    if (!trackIds.length) return;
    // Any confirmed write can change the artwork snapshot or album association.
    invalidateTrackArtworkCache(trackIds);
    invalidateAlbumArtworkCache();
    globalThis.window.dispatchEvent(new globalThis.Event(LIBRARY_CHANGED_EVENT));
    const updated = await Promise.all(trackIds.map(library.getTrack));
    await session.updateTrackMetadata(
      updated.filter((track): track is TrackDetails => track !== null),
    );
  }
  return { tracks, artwork: tracks };
}

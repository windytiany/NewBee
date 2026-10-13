import { createTrackSynchronization } from "@/features/tracks/synchronize";
import type { TracksInvoker } from "@/features/tracks/api";

import type { MetadataTarget, EditorTrack } from "@/features/metadata/types";
import { invalidateTrackArtworkCache } from "@/features/artwork/useTrackArtwork";
import type { usePlaybackSession } from "@/features/playback/session";

import { FILES_CHANGED_EVENT } from "@/features/metadata/events";

export function createTagSynchronization(
  session: Pick<ReturnType<typeof usePlaybackSession>, "updateTrackMetadata">,
  invokeCommand: TracksInvoker,
) {
  const snapshots = createTrackSynchronization(session, invokeCommand);
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
    await snapshots.refresh(trackIds);
  }
  return { tracks, artwork: tracks };
}

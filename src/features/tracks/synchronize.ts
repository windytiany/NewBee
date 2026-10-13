import { createTracksApi } from "@/features/tracks/api";
import type { TracksInvoker } from "@/features/tracks/api";
import { reportTracksChanged } from "@/features/tracks/events";
import type { usePlaybackSession } from "@/features/playback/session";
import type { TrackDetails } from "@/features/tracks/types";

export function createTrackSynchronization(
  session: Pick<ReturnType<typeof usePlaybackSession>, "updateTrackMetadata">,
  invokeCommand: TracksInvoker,
) {
  const api = createTracksApi(invokeCommand);
  async function refresh(trackIds: readonly number[], active: () => boolean = () => true) {
    const ids = [...new Set(trackIds)];
    if (!ids.length) return;
    let tracks: TrackDetails[] | undefined;
    try {
      tracks = await api.getTracks(ids);
    } finally {
      reportTracksChanged(ids, tracks);
    }
    if (active()) await session.updateTrackMetadata(tracks);
  }

  async function reread(trackIds: readonly number[]) {
    const results = await api.rereadTags(trackIds);
    let refreshError: string | null = null;
    try {
      await refresh(
        results.filter((result) => result.databaseUpdated).map((result) => result.trackId),
      );
    } catch (error) {
      refreshError = error instanceof Error ? error.message : String(error);
    }
    return { results, refreshError };
  }

  return { refresh, reread };
}

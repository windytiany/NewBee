import { createPlaylistApi } from "@/features/playlist/api";
import { reportPlaylistChanged } from "@/features/playlist/events";

export function createPlaylistAppend(api: ReturnType<typeof createPlaylistApi>) {
  return async (playlistId: number, trackIds: readonly number[]) => {
    const results = await api.appendTracks(playlistId, trackIds);
    const added = results.flatMap((result) => (result.status === "added" ? [result.trackId] : []));
    const failed = results.filter((result) => result.status === "failed");
    if (added.length) reportPlaylistChanged(playlistId);
    return {
      results,
      error: failed.length ? failed.map((result) => result.error).join("\n") : null,
    };
  };
}

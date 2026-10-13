import { createTracksApi, type TracksInvoker } from "@/features/tracks/api";
import type { TrackDetails } from "@/features/tracks/types";

/** Registers without importing. The callback receives only this batch's successful tracks. */
export function createTrackRegistration(invokeCommand: TracksInvoker) {
  const api = createTracksApi(invokeCommand);
  return async <T extends void | { error: string | null }>(
    paths: readonly string[],
    append: (tracks: readonly TrackDetails[]) => Promise<T>,
    refresh: (ids: readonly number[]) => Promise<void>,
  ) => {
    const results = await api.registerLocalFiles(paths);
    const tracks = results.flatMap((result) =>
      result.status === "registered" ? [result.track] : [],
    );
    let appendResults: T | null = null;
    let appendError: string | null = null;
    let refreshError: string | null = null;
    if (tracks.length) {
      try {
        appendResults = await append(tracks);
        appendError = appendResults?.error ?? null;
      } catch (error) {
        appendError = error instanceof Error ? error.message : String(error);
      }
      // Confirmation may have arrived before these new references existed.
      try {
        await refresh(tracks.map((track) => track.id));
      } catch (error) {
        refreshError = error instanceof Error ? error.message : String(error);
      }
    }
    return { results, appendResults, appendError, refreshError };
  };
}

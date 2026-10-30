import { invoke } from "@tauri-apps/api/core";
import type {
  TrackDetails,
  TrackReadResult,
  TrackRegistrationResult,
} from "@/features/tracks/types";

export type TracksInvoker = typeof invoke;

export function createTracksApi(invokeCommand: TracksInvoker = invoke) {
  return {
    registerLocalFiles: (paths: readonly string[]) =>
      invokeCommand<TrackRegistrationResult[]>("register_local_tracks", { paths }),
    getTrack: (trackId: number) => invokeCommand<TrackDetails | null>("get_track", { trackId }),
    getTracks: (trackIds: readonly number[]) =>
      invokeCommand<TrackDetails[]>("get_tracks", { trackIds }),
    revealFile: (trackId?: number | null, path?: string | null) =>
      invokeCommand<void>("reveal_track_file", { trackId: trackId ?? null, path: path ?? null }),
    rereadTags: (trackIds: readonly number[]) =>
      invokeCommand<TrackReadResult[]>("reread_track_tags", { trackIds }),
  };
}

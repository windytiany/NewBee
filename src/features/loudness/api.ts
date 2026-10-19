import { Channel, invoke } from "@tauri-apps/api/core";

export type LoudnessResult = {
  trackId: number | null;
  fileWritten: boolean;
  databaseUpdated: boolean;
  error: string | null;
};

export type LoudnessProgress = { completed: number; total: number };

function updateLoudness(
  command: "analyze_track_loudness" | "restore_track_loudness",
  trackIds: readonly number[],
  progress: (value: LoudnessProgress) => void,
  paths: readonly string[],
): Promise<LoudnessResult[]> {
  const onProgress = new Channel<LoudnessProgress>();
  onProgress.onmessage = progress;
  return invoke(command, {
    trackIds: [...new Set(trackIds)],
    paths: [...new Set(paths)],
    onProgress,
  });
}

export function analyzeLoudness(
  trackIds: readonly number[],
  progress: (value: LoudnessProgress) => void,
  paths: readonly string[] = [],
): Promise<LoudnessResult[]> {
  return updateLoudness("analyze_track_loudness", trackIds, progress, paths);
}

export function restoreLoudness(
  trackIds: readonly number[],
  progress: (value: LoudnessProgress) => void,
  paths: readonly string[] = [],
): Promise<LoudnessResult[]> {
  return updateLoudness("restore_track_loudness", trackIds, progress, paths);
}

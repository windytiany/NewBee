import { Channel } from "@tauri-apps/api/core";
import { taskInvoke as invoke } from "@/features/tasks/commands";

export type ReplayGainResult = {
  trackId: number | null;
  fileWritten: boolean;
  databaseUpdated: boolean;
  error: string | null;
};

export type ReplayGainProgress = { completed: number; total: number };

function updateReplayGain(
  command: "analyze_track_loudness" | "restore_track_loudness",
  trackIds: readonly number[],
  progress: (value: ReplayGainProgress) => void,
  paths: readonly string[],
  operationId?: string,
): Promise<ReplayGainResult[]> {
  const onProgress = new Channel<ReplayGainProgress>();
  onProgress.onmessage = progress;
  return invoke(command, {
    trackIds: [...new Set(trackIds)],
    paths: [...new Set(paths)],
    onProgress,
    ...(operationId ? { operationId } : {}),
  });
}

export function analyzeReplayGain(
  trackIds: readonly number[],
  progress: (value: ReplayGainProgress) => void,
  paths: readonly string[] = [],
  operationId?: string,
): Promise<ReplayGainResult[]> {
  return updateReplayGain("analyze_track_loudness", trackIds, progress, paths, operationId);
}

export function removeReplayGain(
  trackIds: readonly number[],
  progress: (value: ReplayGainProgress) => void,
  paths: readonly string[] = [],
  operationId?: string,
): Promise<ReplayGainResult[]> {
  return updateReplayGain("restore_track_loudness", trackIds, progress, paths, operationId);
}

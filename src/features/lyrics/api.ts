import { invoke } from "@tauri-apps/api/core";
import type { Channel } from "@tauri-apps/api/core";
import type {
  LyricsBatchEvent,
  LyricsBatchSummary,
  LyricsCandidate,
  LyricsContent,
  LyricsDownloadTarget,
  LyricsProvider,
  LyricsSearchResults,
  TrackLyrics,
} from "@/features/lyrics/types";
import type { MetadataSaveResult } from "@/features/metadata/types";

type LyricsInvoker = <Result>(command: string, args?: Record<string, unknown>) => Promise<Result>;

export function createLyricsApi(invokeCommand: LyricsInvoker = invoke) {
  return {
    read: (trackId: number) => invokeCommand<TrackLyrics>("get_track_lyrics", { trackId }),
    search: (query: string, provider: LyricsProvider | null, offset: number) =>
      invokeCommand<LyricsSearchResults>("search_lyrics_candidates", { query, provider, offset }),
    preview: (candidate: LyricsCandidate) =>
      invokeCommand<LyricsContent>("get_candidate_lyrics", {
        provider: candidate.provider,
        candidateId: candidate.id,
      }),
    automatic: (trackId: number) => invokeCommand<LyricsContent>("find_track_lyrics", { trackId }),
    targets: (trackIds: number[]) =>
      invokeCommand<LyricsDownloadTarget[]>("get_lyrics_download_targets", { trackIds }),
    run: (trackIds: number[], onProgress: Channel<LyricsBatchEvent>, operationId: string) =>
      invokeCommand<LyricsBatchSummary>("run_lyrics_download", {
        trackIds,
        onProgress,
        operationId,
      }),
    commitStep: (batchId: number, stepId: number) =>
      invokeCommand<MetadataSaveResult>("commit_lyrics_download_step", { batchId, stepId }),
    completeStep: (batchId: number, stepId: number, error: string | null) =>
      invokeCommand<void>("complete_lyrics_download_step", { batchId, stepId, error }),
    cancel: (batchId: number) => invokeCommand<void>("cancel_lyrics_download", { batchId }),
  };
}

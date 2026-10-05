import { invoke } from "@tauri-apps/api/core";
import type {
  LyricsCandidate,
  LyricsContent,
  LyricsDownloadTarget,
  LyricsProvider,
  LyricsSearchResults,
  TrackLyrics,
} from "@/features/lyrics/types";
import type { TagSaveResult } from "@/features/tags/types";

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
    mark: (batchId: number, trackId: number) =>
      invokeCommand<TagSaveResult>("write_batch_lyrics", { batchId, trackId, text: null }),
    begin: (trackIds: number[]) => invokeCommand<number>("begin_lyrics_download", { trackIds }),
    fetch: (batchId: number, trackId: number) =>
      invokeCommand<LyricsContent>("fetch_batch_lyrics", { batchId, trackId }),
    write: (batchId: number, trackId: number, text: string) =>
      invokeCommand<TagSaveResult>("write_batch_lyrics", { batchId, trackId, text }),
    cancel: (batchId: number) => invokeCommand<void>("cancel_lyrics_download", { batchId }),
    finish: (batchId: number) => invokeCommand<void>("finish_lyrics_download", { batchId }),
  };
}

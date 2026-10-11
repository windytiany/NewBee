import type { MetadataSaveResult } from "@/features/metadata/types";

export type LyricLine = {
  startMs: number;
  text: string;
};

export type TrackLyrics =
  | { kind: "none" }
  | { kind: "instrumental" }
  | { kind: "plain"; text: string }
  | { kind: "synced"; lines: readonly LyricLine[] };

export type LyricsDownloadTarget = {
  id: number;
  title: string | null;
  artist: string | null;
  hasLyrics: boolean;
  noLyrics: boolean;
};

export type LyricsProvider = "netease";
export type LyricsCandidate = {
  provider: LyricsProvider;
  id: number;
  title: string;
  artists: string[];
  album: string;
  durationMs: number | null;
};
export type LyricsSearchResults = {
  candidates: LyricsCandidate[];
  nextOffset: number | null;
};
export type LyricsContent =
  { kind: "available"; text: string } | { kind: "instrumental" } | { kind: "missing" };

export type LyricsBatchOutcome = {
  trackId: number;
  kind: "available" | "instrumental" | "missing" | "failed";
  result: MetadataSaveResult | null;
  error: string | null;
};
export type LyricsBatchSummary = {
  batchId: number;
  status: "completed" | "cancelled" | "failed";
  results: LyricsBatchOutcome[];
  error: string | null;
};
export type LyricsBatchEvent =
  | { kind: "started"; batchId: number; total: number }
  | {
      kind: "saveRequested";
      batchId: number;
      stepId: number;
      trackId: number;
      path: string;
      content: "available" | "instrumental";
    }
  | { kind: "trackCompleted"; batchId: number; outcome: LyricsBatchOutcome };

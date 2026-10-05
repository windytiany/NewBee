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

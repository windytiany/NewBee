export type LyricLine = {
  startMs: number;
  text: string;
};

export type TrackLyrics =
  | { kind: "none" }
  | { kind: "plain"; text: string }
  | { kind: "synced"; lines: readonly LyricLine[] };

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

export function searchQuery(track: { title: string | null; artist: string | null; path: string }) {
  const filename =
    track.path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "";
  return [track.title?.trim() || filename, track.artist?.trim()].filter(Boolean).join(" ");
}

export function contentMessage(content: LyricsContent) {
  return content.kind === "instrumental" ? "此曲目为纯音乐。" : "未找到歌词。";
}

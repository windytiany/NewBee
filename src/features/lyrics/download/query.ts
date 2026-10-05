import type { LyricsContent } from "@/features/lyrics/types";

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

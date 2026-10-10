import { t } from "@/shared/i18n/locale";
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
  return content.kind === "instrumental" ? t("此曲目为纯音乐。") : t("未找到歌词。");
}

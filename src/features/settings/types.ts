import type { Locale } from "@/shared/i18n/locale";
import type { LyricsProvider } from "@/features/lyrics/types";

export type NeteaseLyricsMode = "original" | "translated" | "bilingual";

export type Settings = {
  locale: Locale;
  accentColor: string;
  reducedMotion: boolean;
  albumCoverBackground: boolean;
  playingCoverBackground: boolean;
  closeBehavior: "tray" | "exit";
  albumSortBy: "name" | "year";
  albumSortOrder: "ascending" | "descending";
  lyricsProviders: LyricsProvider[];
  neteaseLyricsMode: NeteaseLyricsMode;
};

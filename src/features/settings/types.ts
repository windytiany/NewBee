import type { Locale } from "@/shared/i18n/locale";
import type { LyricsProvider } from "@/features/lyrics/types";
import type { ShortcutAction } from "@/features/shortcuts/bindings";

export type NeteaseLyricsMode = "original" | "translated" | "bilingual";

export type ShortcutBinding = {
  shortcut: string;
  global: boolean;
};

export type ShortcutSettings = Record<ShortcutAction, ShortcutBinding>;

export type Settings = {
  shortcuts: ShortcutSettings;
  locale: Locale;
  accentColor: string;
  reducedMotion: boolean;
  layoutDensity: "regular" | "compact";
  albumCoverBackground: boolean;
  playingCoverBackground: boolean;
  closeBehavior: "tray" | "exit";
  showPlaybackStatistics: boolean;
  albumSortBy: "name" | "year";
  albumSortOrder: "ascending" | "descending";
  lyricsProviders: LyricsProvider[];
  neteaseLyricsMode: NeteaseLyricsMode;
};

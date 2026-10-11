import type { Locale } from "@/shared/i18n/locale";
import type { LyricsProvider } from "@/features/lyrics/types";

export type NeteaseLyricsMode = "original" | "translated" | "bilingual";

export type ShortcutBinding = {
  shortcut: string;
  global: boolean;
};

export type ShortcutSettings = {
  previous: ShortcutBinding;
  next: ShortcutBinding;
  togglePlayback: ShortcutBinding;
  toggleWindow: ShortcutBinding;
};

export type Settings = {
  shortcuts: ShortcutSettings;
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

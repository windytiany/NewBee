import type { Theme } from "@/features/settings/theme";
import type { LyricsProvider } from "@/features/lyrics/types";

export type Settings = {
  theme: Theme;
  albumCoverBackground: boolean;
  closeBehavior: "tray" | "exit";
  albumSortBy: "name" | "year";
  albumSortOrder: "ascending" | "descending";
  lyricsProviders: LyricsProvider[];
};

import type { Theme } from "@/settings/theme";

export type Settings = {
  theme: Theme;
  albumCoverBackground: boolean;
  closeBehavior: "tray" | "exit";
  albumSortBy: "name" | "year";
  albumSortOrder: "ascending" | "descending";
};

export const SETTINGS_CHANGED_EVENT = "newbee:settings-changed";

export type Settings = {
  closeBehavior: "tray" | "exit";
  albumSortBy: "name" | "year";
  albumSortOrder: "ascending" | "descending";
};

export const SETTINGS_CHANGED_EVENT = "newbee:settings-changed";

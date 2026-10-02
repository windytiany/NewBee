export const pageNames = ["Playing", "Library", "Playlist"] as const;
export type PageName = (typeof pageNames)[number];

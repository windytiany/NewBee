export const pageNames = ["Playing", "Library", "Playlist"] as const;
export type PageName = (typeof pageNames)[number];

export type BrandMenuAction = "import" | "scan" | "migrate" | "settings";

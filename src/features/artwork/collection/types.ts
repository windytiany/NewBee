export type ArtworkPicture = {
  artworkId: number;
  contentId: string;
  mimeType: string;
  byteLength: number;
  pictureType: number;
  source: "embedded" | "directory" | "manual";
  path: string;
  error: string | null;
};

export type ArtworkCollection = {
  trackId: number;
  pictures: ArtworkPicture[];
  displayIndex: number | null;
  error: string | null;
};

export type ArtworkPictureDraft =
  | { source: "existing"; artworkId: number; pictureType: number }
  | { source: "embedded"; data: number[]; pictureType: number }
  | { source: "linked"; path: string; pictureType: number };

export type ArtworkDraft = {
  trackId: number;
  pictures: ArtworkPictureDraft[];
  displayIndex: number | null;
};

export type ArtworkWritePlan = {
  trackId: number;
  fileWriteRequired: boolean;
  error: string | null;
};

export type DraftPicture = {
  key: string;
  contentId: string;
  mimeType: string;
  byteLength: number;
  storage: "embedded" | "linked";
  path: string;
  error: string | null;
  picture: ArtworkPictureDraft;
};

export type CollectionSnapshot = {
  pictures: DraftPicture[];
  displayKey: string | null;
};

export type CollectionTrack = CollectionSnapshot & {
  trackId: number;
  error: string | null;
  original: CollectionSnapshot;
};

export type CollectionDraft = { tracks: CollectionTrack[] };
export type CommonPicture = Omit<DraftPicture, "picture"> & {
  pictureType: number | null;
  mixed: boolean;
};
export type DisplaySelection =
  { mixed: true; picture: null } | { mixed: false; picture: DraftPicture | null };

export type ArtworkPicture = {
  contentId: string;
  mimeType: string;
  byteLength: number;
  pictureType: number;
  embedded: boolean;
};

export type ArtworkCollection = {
  trackId: number;
  pictures: ArtworkPicture[];
  displayIndex: number | null;
  error: string | null;
};

export type ArtworkPictureDraft =
  | { source: "existing"; contentId: string; pictureType: number }
  | { source: "new"; data: number[]; pictureType: number };

export type ArtworkDraft = {
  trackId: number;
  pictures: ArtworkPictureDraft[];
  displayIndex: number | null;
};

export type DraftPicture = {
  key: string;
  mimeType: string;
  byteLength: number;
  embedded: boolean;
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
export type CommonPicture = Omit<DraftPicture, "picture" | "embedded"> & {
  pictureType: number | null;
  mixed: boolean;
};
export type DisplaySelection =
  { mixed: true; picture: null } | { mixed: false; picture: DraftPicture | null };

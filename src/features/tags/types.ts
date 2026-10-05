import type { TrackDetails } from "@/features/library/types";
import type { TAG_FIELDS } from "@/features/tags/draft";

export type TagField = (typeof TAG_FIELDS)[number]["key"] | "lyrics";
export type LyricsMarkAction = "keep" | "mark" | "unmark";
export type EditMode = "tracks" | "album";
export type EditableTrack = {
  track: TrackDetails;
  lyrics: string | null;
  noLyrics: boolean;
  writableFields: TagField[];
  issue: string | null;
};
export type TagChange = { field: TagField; value: string | null };
export type TagSaveResult = {
  trackId: number;
  path: string;
  fileWritten: boolean;
  databaseUpdated: boolean;
  error: string | null;
};
export type DraftField = {
  key: TagField;
  label: string;
  type: "text" | "date" | "number";
  value: string;
  mixed: boolean;
  writable: boolean;
  originalValue?: string;
};

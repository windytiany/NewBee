import type { TrackDetails } from "@/features/tracks/types";
import type { TAG_FIELDS } from "@/features/metadata/draft";

export type EditorTrack = TrackDetails;

export type TagField = (typeof TAG_FIELDS)[number]["key"] | "lyrics";
export type LyricsMarkAction = "keep" | "mark" | "unmark";
export type EditMode = "tracks" | "album";
export type EditableTrack = {
  track: EditorTrack;
  lyrics: string | null;
  noLyrics: boolean;
  writableFields: TagField[];
  issue: string | null;
  values?: Partial<Record<TagField, string>>;
};
export type IdentifierField =
  | "musicBrainzReleaseId"
  | "musicBrainzReleaseGroupId"
  | "musicBrainzTrackId"
  | "musicBrainzRecordingId"
  | "musicBrainzArtistId"
  | "musicBrainzAlbumArtistId";
export type TagChange =
  | { field: TagField; value: string | null }
  | { field: IdentifierField; value: null; values: string[] };
export type MetadataSaveResult = {
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

import type { MetadataTarget } from "@/features/metadata/types";
import type { TAG_FIELDS } from "@/features/metadata/draft";
import type { TagChange, IdentifierField } from "@/features/metadata/types";

export type ReleaseSummary = {
  id: string;
  title: string;
  artist: string | null;
  releaseDate: string | null;
  country: string | null;
  status: string | null;
  disambiguation: string | null;
  formats: string[];
  discCount: number;
  trackCount: number;
};
export type ReleaseTrack = {
  title: string;
  artist: string | null;
  discNumber: number;
  trackNumber: number;
  trackTotal: number;
  durationMs: number | null;
  values?: Partial<Record<AlbumField, string>>;
  identifiers?: Partial<Record<IdentifierField, string[]>>;
};
export type ReleaseDetails = {
  summary: ReleaseSummary;
  tracks: ReleaseTrack[];
  values?: Partial<Record<AlbumField, string>>;
  identifiers?: Partial<Record<IdentifierField, string[]>>;
};
export type SearchResults = { count: number; offset: number; releases: ReleaseSummary[] };
export type CoverChoice = { id: string; comment: string };
export type CoverData = { mimeType: string; data: number[] };
export type AlbumField = (typeof TAG_FIELDS)[number]["key"];
export type MatchRow = {
  source: ReleaseTrack | null;
  trackId: MetadataTarget | null;
  values: Partial<Record<AlbumField, string>>;
  identifiers?: Partial<Record<IdentifierField, string[]>>;
};
export type TrackPatch = { trackId: MetadataTarget; changes: TagChange[]; writeCover: boolean };

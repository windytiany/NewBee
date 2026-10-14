export type TrackSummary = {
  discNumber: number | null;
  trackNumber: number | null;
  id: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
};

export type TrackDetails = {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  releaseDate: string | null;
  discNumber: number | null;
  trackNumber: number | null;
  discTotal: number | null;
  trackTotal: number | null;
  durationMs: number | null;
  codec: string | null;
  sampleRateHz: number | null;
  bitrateKbps: number | null;
  channels: number | null;
};

export type TrackPresentation = Pick<TrackDetails, "title" | "album" | "durationMs">;

export type TrackRegistrationResult =
  | { status: "registered"; track: TrackDetails; needsMetadata: boolean }
  | { status: "failed"; path: string; error: string };

export type TrackReadResult = {
  trackId: number;
  databaseUpdated: boolean;
  error: string | null;
};

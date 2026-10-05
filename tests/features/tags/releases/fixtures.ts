import { TAG_FIELDS } from "@/features/tags/draft";
import type { EditableTrack } from "@/features/tags/types";
import type { ReleaseDetails } from "@/features/tags/releases/types";
export const album = { albumArtist: "Artist", album: "Album" };
export function local(id: number, title = `Song ${id}`, discNumber = 1): EditableTrack {
  return {
    track: {
      id,
      path: `/music/${id}.flac`,
      title,
      artist: "Artist",
      album: "Album",
      albumArtist: "Artist",
      releaseDate: "1998",
      trackNumber: id,
      discNumber,
      trackTotal: 12,
      discTotal: 1,
      durationMs: 180000,
      codec: "FLAC",
      sampleRateHz: 44100,
      bitrateKbps: null,
      channels: 2,
    },
    lyrics: null,
    writableFields: TAG_FIELDS.map(({ key }) => key),
    issue: null,
  };
}
export function release(id = "76df3287-6cda-33eb-8e9a-044b5e15ffdd"): ReleaseDetails {
  return {
    summary: {
      id,
      title: "Album",
      artist: "Artist",
      releaseDate: "2016",
      country: "TW",
      status: "Official",
      disambiguation: "reissue",
      formats: ["CD"],
      discCount: 2,
      trackCount: 4,
    },
    tracks: [1, 2, 3, 4].map((number) => ({
      title: `Song ${number}`,
      artist: "Artist",
      discNumber: number <= 2 ? 1 : 2,
      trackNumber: number <= 2 ? number : number - 2,
      trackTotal: 2,
      durationMs: 180000,
    })),
  };
}

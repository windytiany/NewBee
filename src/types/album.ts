import type { Track } from "./track.ts";

export type Album = {
  id: string;
  title: string;
  artist: string;
  year: number;
  tracks: Track[];
};

import type { Track } from "@/types/track.ts";

export type Album = {
  id: string;
  title: string;
  artist: string;
  year: number;
  tracks: Track[];
};

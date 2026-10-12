import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export function readArtistPhoto(artist: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("get_artist_photo", { artist });
}

export function saveArtistPhoto(artist: string, data: number[]): Promise<void> {
  return invoke<void>("save_artist_photo", { artist, data });
}

export function searchArtistPhoto(artist: string): Promise<void> {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("tbm", "isch");
  url.searchParams.set("q", artist);
  return openUrl(url.href);
}

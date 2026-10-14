import { invoke } from "@tauri-apps/api/core";
import type {
  ArtworkCollection,
  ArtworkDraft,
  ArtworkWritePlan,
} from "@/features/artwork/collection/types";

export type ArtworkSize = null | 128 | 512 | 2048;

export function createArtworkCollectionApi(invokeCommand: typeof invoke = invoke) {
  return {
    collections: (trackIds: readonly number[]) =>
      invokeCommand<ArtworkCollection[]>("get_track_artwork_collections", {
        trackIds: [...trackIds],
      }),
    picture: (artworkId: number, size: ArtworkSize = null) =>
      invokeCommand<ArrayBuffer>("get_artwork_picture", { artworkId, size }),
    readFile: (path: string) => invokeCommand<number[]>("read_artwork_file", { path }),
    writePlan: (artworkDrafts: ArtworkDraft[]) =>
      invokeCommand<ArtworkWritePlan[]>("get_artwork_write_plan", { artworkDrafts }),
  };
}

import { invoke } from "@tauri-apps/api/core";
import type { ArtworkCollection } from "@/features/artwork/collection/types";

export type ArtworkSize = null | 128 | 512 | 2048;

export function createArtworkCollectionApi(invokeCommand: typeof invoke = invoke) {
  return {
    collections: (trackIds: readonly number[]) =>
      invokeCommand<ArtworkCollection[]>("get_track_artwork_collections", {
        trackIds: [...trackIds],
      }),
    content: (contentId: string, size: ArtworkSize = null) =>
      invokeCommand<ArrayBuffer>("get_artwork_content", { contentId, size }),
  };
}

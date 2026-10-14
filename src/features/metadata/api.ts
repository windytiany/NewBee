import { invoke } from "@tauri-apps/api/core";
import type { Channel } from "@tauri-apps/api/core";
import type {
  EditableTrack,
  LyricsMarkAction,
  TagChange,
  MetadataSaveResult,
} from "@/features/metadata/types";
import type {
  CoverChoice,
  CoverData,
  ReleaseDetails,
  SearchResults,
  TrackPatch,
} from "@/features/metadata/releases/types";
import type { ArtworkDraft } from "@/features/artwork/collection/types";

export function createMetadataApi(invokeCommand: typeof invoke = invoke) {
  return {
    editableTracks: (trackIds: number[]) =>
      invokeCommand<EditableTrack[]>("get_editable_tracks", { trackIds }),
    saveMetadata: (
      trackIds: number[],
      changes: TagChange[],
      onProgress: Channel<MetadataSaveResult>,
      lyricsAction: LyricsMarkAction,
      operationId?: string,
      artworkDrafts: ArtworkDraft[] = [],
    ) => {
      return invokeCommand<MetadataSaveResult[]>("save_track_metadata", {
        request: { trackIds, changes, lyricsAction, artworkDrafts },
        onProgress,
        ...(operationId ? { operationId } : {}),
      });
    },
    searchReleases: (artist: string, album: string, offset: number) =>
      invokeCommand<SearchResults>("search_album_releases", { artist, album, offset }),
    release: (releaseId: string) =>
      invokeCommand<ReleaseDetails>("get_album_release", { releaseId }),
    covers: (releaseId: string) =>
      invokeCommand<CoverChoice[]>("get_release_covers", { releaseId }),
    cover: (releaseId: string, coverId: string) =>
      invokeCommand<CoverData>("get_release_cover", { releaseId, coverId }),
    saveRelease: (
      patches: TrackPatch[],
      cover: CoverData | null,
      onProgress: Channel<MetadataSaveResult>,
      operationId?: string,
    ) => {
      return invokeCommand<MetadataSaveResult[]>("save_album_tags", {
        patches,
        cover,
        onProgress,
        ...(operationId ? { operationId } : {}),
      });
    },
  };
}

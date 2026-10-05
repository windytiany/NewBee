import { invoke } from "@tauri-apps/api/core";
import type { Channel } from "@tauri-apps/api/core";
import type {
  EditableTrack,
  LyricsMarkAction,
  TagChange,
  TagSaveResult,
} from "@/features/tags/types";
import type {
  CoverChoice,
  CoverData,
  ReleaseDetails,
  SearchResults,
  TrackPatch,
} from "@/features/tags/releases/types";

export function createTagsApi(invokeCommand: typeof invoke = invoke) {
  return {
    editableTracks: (trackIds: number[]) =>
      invokeCommand<EditableTrack[]>("get_editable_tracks", { trackIds }),
    saveMetadata: (
      trackIds: number[],
      changes: TagChange[],
      onProgress: Channel<TagSaveResult>,
      lyricsAction: LyricsMarkAction,
    ) =>
      invokeCommand<TagSaveResult[]>("save_track_metadata", {
        trackIds,
        changes,
        onProgress,
        lyricsAction,
      }),
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
      onProgress: Channel<TagSaveResult>,
    ) => invokeCommand<TagSaveResult[]>("save_album_tags", { patches, cover, onProgress }),
  };
}

import type { invoke } from "@tauri-apps/api/core";
import { taskInvoke } from "@/features/tasks/commands";
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

export function createMetadataApi(invokeCommand: typeof invoke = taskInvoke) {
  const revisions = new Map<number, string>();
  const expected = (ids: number[]) =>
    ids.flatMap((trackId) => {
      const value = revisions.get(trackId);
      return value ? [{ trackId, value }] : [];
    });
  return {
    editableTracks: async (trackIds: number[]) => {
      const tracks = await invokeCommand<EditableTrack[]>("get_editable_tracks", { trackIds });
      for (const { track, revision } of tracks) {
        revisions.delete(track.id);
        if (revision) revisions.set(track.id, revision);
      }
      return tracks;
    },
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
        ...(expected(trackIds).length ? { expected: expected(trackIds) } : {}),
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
        ...(expected(patches.map((patch) => patch.trackId)).length
          ? { expected: expected(patches.map((patch) => patch.trackId)) }
          : {}),
        ...(operationId ? { operationId } : {}),
      });
    },
  };
}

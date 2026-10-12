import { invoke } from "@tauri-apps/api/core";
import type { Channel } from "@tauri-apps/api/core";
import type {
  CoverEdit,
  EditableTrack,
  LyricsMarkAction,
  TagChange,
  MetadataSaveResult,
  MetadataTarget,
} from "@/features/metadata/types";
import type {
  CoverChoice,
  CoverData,
  ReleaseDetails,
  SearchResults,
  TrackPatch,
} from "@/features/metadata/releases/types";
import { t } from "@/shared/i18n/locale";

function filePaths(targets: readonly MetadataTarget[]): string[] | null {
  if (targets.every((target) => typeof target === "number")) return null;
  if (targets.every((target) => typeof target === "string"))
    return targets.filter((target): target is string => typeof target === "string");
  throw new Error(t("返回的曲目与编辑目标不匹配。"));
}

export function createMetadataApi(invokeCommand: typeof invoke = invoke) {
  return {
    editableTracks: (trackIds: MetadataTarget[]) => {
      const paths = filePaths(trackIds);
      return paths
        ? invokeCommand<EditableTrack[]>("get_editable_files", { paths })
        : invokeCommand<EditableTrack[]>("get_editable_tracks", { trackIds });
    },
    saveMetadata: (
      trackIds: MetadataTarget[],
      changes: TagChange[],
      onProgress: Channel<MetadataSaveResult>,
      lyricsAction: LyricsMarkAction,
      operationId?: string,
      cover?: CoverEdit | null,
    ) => {
      const paths = filePaths(trackIds);
      if (paths) {
        if (lyricsAction !== "keep") throw new Error(t("无效的文件操作"));
        return invokeCommand<MetadataSaveResult[]>("save_file_metadata", {
          patches: paths.map((path) => ({ path, changes, writeCover: cover != null })),
          cover: cover ?? null,
          onProgress,
          ...(operationId ? { operationId } : {}),
        });
      }
      return invokeCommand<MetadataSaveResult[]>("save_track_metadata", {
        request: { trackIds, changes, lyricsAction, cover: cover ?? null },
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
      const paths = filePaths(patches.map((patch) => patch.trackId));
      if (paths)
        return invokeCommand<MetadataSaveResult[]>("save_file_metadata", {
          patches: patches.map(({ changes, writeCover }, index) => ({
            path: paths[index],
            changes,
            writeCover,
          })),
          cover: cover ? { action: "replace", data: cover.data } : null,
          onProgress,
          ...(operationId ? { operationId } : {}),
        });
      return invokeCommand<MetadataSaveResult[]>("save_album_tags", {
        patches,
        cover,
        onProgress,
        ...(operationId ? { operationId } : {}),
      });
    },
  };
}

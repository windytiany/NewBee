import type { createMetadataApi } from "@/features/metadata/api";
import type { createTracksApi } from "@/features/tracks/api";
import type { EditableTrack, MetadataTarget } from "@/features/metadata/types";
import { t } from "@/shared/i18n/locale";

export function createManualLoading(
  metadata: Pick<ReturnType<typeof createMetadataApi>, "editableTracks">,
  tracks: Pick<ReturnType<typeof createTracksApi>, "registerLocalFiles">,
) {
  return async (targets: MetadataTarget[]): Promise<EditableTrack[]> => {
    if (targets.every((target) => typeof target === "number"))
      return metadata.editableTracks(targets);
    if (!targets.every((target) => typeof target === "string"))
      throw new Error(t("返回的曲目与编辑目标不匹配。"));
    const paths = targets.filter((target): target is string => typeof target === "string");
    const snapshots = await metadata.editableTracks(paths);
    if (
      snapshots.length !== paths.length ||
      new Set(snapshots.map(({ track }) => track.path)).size !== paths.length ||
      snapshots.some(({ track }) => track.id !== track.path || !paths.includes(track.path))
    )
      throw new Error(t("返回的曲目与编辑目标不匹配。"));
    const registered = await tracks.registerLocalFiles(paths);
    if (registered.length !== paths.length) throw new Error(t("返回的曲目与编辑目标不匹配。"));
    const ids = new Map<string, number>();
    for (const result of registered) {
      if (result.status === "failed") throw new Error(result.error);
      const { id, path } = result.track;
      if (
        !paths.includes(path) ||
        ids.has(path) ||
        [...ids.values()].includes(id) ||
        !Number.isSafeInteger(id) ||
        id <= 0
      )
        throw new Error(t("返回的曲目与编辑目标不匹配。"));
      ids.set(path, id);
    }
    return snapshots.map((snapshot) => {
      const id = ids.get(snapshot.track.path);
      if (id === undefined) throw new Error(t("返回的曲目与编辑目标不匹配。"));
      return { ...snapshot, track: { ...snapshot.track, id } };
    });
  };
}

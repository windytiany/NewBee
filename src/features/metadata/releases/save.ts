import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { TAG_FIELDS } from "@/features/metadata/draft";
import { metadataSaved } from "@/features/metadata/save";
import type { createMetadataSave } from "@/features/metadata/save";
import { buildAlbumPatches } from "@/features/metadata/releases/matching";
import type { CoverData } from "@/features/metadata/releases/types";
import type { ReleaseEditorState, ReleaseErrorReporter } from "@/features/metadata/releases/state";
import type { ReleaseEditorOptions } from "@/features/metadata/releases/useEditor";

export function createReleaseSave(
  state: ReleaseEditorState,
  options: Pick<ReleaseEditorOptions, "save">,
  saving: ReturnType<typeof createMetadataSave>,
  busy: () => boolean,
  close: () => void,
  reportError: ReleaseErrorReporter,
) {
  let savedCover: CoverData | null = null;
  function confirmPatches() {
    if (!state.patches.length && state.synchronizationError) {
      state.confirmSave = true;
      return;
    }
    if (!state.patches.length) {
      reportError("release_changes_empty", new Error(t("没有需要写入的改动。")));
      return;
    }
    state.confirmSave = true;
  }
  function prepareSave() {
    if (busy() || state.loadingRelease) return;
    state.error = "";
    try {
      if (state.writeCover && (!state.cover || state.loadingCover))
        throw new Error(t("请等待封面下载完成，或取消封面覆盖。"));
      state.patches = buildAlbumPatches(
        state.rows,
        state.tracks,
        state.fields,
        state.included,
        state.writeCover,
      ).filter(
        ({ trackId }) =>
          !state.results.some((result) => result.trackId === trackId && metadataSaved(result)),
      );
      const unsupported = state.rows.filter((row) => {
        if (!row.source || row.trackId === null || !state.included.includes(row.trackId))
          return false;
        const local = state.tracks.find(({ track }) => track.id === row.trackId);
        const fields = state.fields.filter(
          (field) => row.values[field] !== undefined && !local?.writableFields.includes(field),
        );
        if (!fields.length) return false;
        logger.warn("metadata", "release_fields_unsupported", "不支持写入", {
          trackId: row.trackId,
          context: fields.join(","),
        });
        return true;
      });
      if (unsupported.length)
        notify({
          type: "warning",
          message: t("{count} 首曲目不支持写入部分所选字段，请核对所选字段。", {
            count: unsupported.length,
          }),
        });
      savedCover = state.writeCover ? state.cover : null;
      confirmPatches();
    } catch (error) {
      reportError("release_validation_failed", error);
    }
  }
  async function save() {
    if (!state.confirmSave || state.saving) return;
    const cover = savedCover;
    close();
    if (!state.patches.length) {
      await saving.retrySynchronization();
      state.open = Boolean(state.synchronizationError);
      return;
    }
    const patches = state.patches.map((patch) => ({
      ...patch,
      changes: patch.changes.map((change) => ({ ...change })),
    }));
    const targets = patches.map(({ trackId }) => ({
      trackId,
      path: state.tracks.find(({ track }) => track.id === trackId)?.track.path ?? "",
    }));
    const results = await saving.run({
      targets,
      writeTrackIds: patches.map(({ trackId }) => trackId),
      execute: (progress, operationId) => options.save(patches, cover, progress, operationId),
    });
    const updated = new Set(
      results.flatMap((result) => (metadataSaved(result) ? [result.trackId] : [])),
    );
    for (const patch of patches) {
      if (!updated.has(patch.trackId)) continue;
      const local = state.tracks.find(({ track }) => track.id === patch.trackId);
      if (!local) continue;
      for (const change of patch.changes) {
        const field = TAG_FIELDS.find(({ key }) => key === change.field);
        if (!field) continue;
        const value =
          change.value !== null && field.type === "number" ? Number(change.value) : change.value;
        if (field.key in local.track) Object.assign(local.track, { [field.key]: value });
        else {
          local.values ??= {};
          if (change.value === null) delete local.values[field.key];
          else local.values[field.key] = change.value;
        }
      }
    }
    state.dirty = state.results.some((result) => !metadataSaved(result));
    if (state.dirty || state.error || state.synchronizationError) {
      state.open = true;
      state.cover = cover;
      savedCover = cover;
    }
  }
  return {
    prepareSave,
    save,
    reset: () => {
      savedCover = null;
    },
  };
}

import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { TAG_FIELDS } from "@/features/metadata/draft";
import { createMatchRows } from "@/features/metadata/releases/matching";
import type { createReleaseArtwork } from "@/features/metadata/releases/artwork";
import type { ReleaseEditorState, ReleaseErrorReporter } from "@/features/metadata/releases/state";
import type { ReleaseEditorOptions } from "@/features/metadata/releases/useEditor";

export function createReleaseSelection(
  state: ReleaseEditorState,
  options: Pick<ReleaseEditorOptions, "release">,
  artwork: ReturnType<typeof createReleaseArtwork>,
  reportError: ReleaseErrorReporter,
) {
  let releaseGeneration = 0;
  async function loadRelease(id: string) {
    const generation = ++releaseGeneration;
    artwork.invalidate();
    state.loadingRelease = true;
    state.loadingCover = false;
    state.error = "";
    try {
      const release = await options.release(id);
      if (generation !== releaseGeneration || !state.open) return;
      state.selected = release;
      state.rows = createMatchRows(release, state.tracks);
      if (release.summary.trackCount !== state.tracks.length) {
        const text = `来源 ${release.summary.trackCount} 首 / 本地 ${state.tracks.length} 首，曲目数量不一致，请核对对应关系。`;
        logger.warn("metadata", "release_track_count_mismatch", text, {
          context: release.summary.id,
        });
        notify({
          type: "warning",
          message: t("来源 {sourceCount} 首 / 本地 {count} 首，曲目数量不一致，请核对对应关系。", {
            sourceCount: release.summary.trackCount,
            count: state.tracks.length,
          }),
        });
      }
      state.fields = TAG_FIELDS.flatMap(({ key }) =>
        state.rows.some((row) => row.values[key] !== undefined) ? [key] : [],
      );
      state.included = state.tracks.flatMap(({ issue, track }) => (issue ? [] : [track.id]));
      state.covers = [];
      state.coverId = "";
      state.cover = null;
      state.writeCover = false;
      state.coverError = "";
      state.dirty = false;
      state.results = [];
      state.patches = [];
      void artwork.loadCovers(release.summary.id);
    } catch (error) {
      if (generation === releaseGeneration) reportError("release_load_failed", error);
    } finally {
      if (generation === releaseGeneration) state.loadingRelease = false;
    }
  }
  return {
    loadRelease,
    invalidate: () => {
      ++releaseGeneration;
      artwork.invalidate();
    },
  };
}

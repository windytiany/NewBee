import { markRaw } from "vue";
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import type { ReleaseEditorState, ReleaseErrorReporter } from "@/features/metadata/releases/state";
import type { ReleaseEditorOptions } from "@/features/metadata/releases/useEditor";

export function createReleaseArtwork(
  state: ReleaseEditorState,
  options: Pick<ReleaseEditorOptions, "covers" | "cover">,
  reportError: ReleaseErrorReporter,
) {
  let releaseGeneration = 0;
  let coverGeneration = 0;
  async function loadCovers(id: string) {
    const generation = releaseGeneration;
    state.loadingCover = true;
    try {
      const covers = await options.covers(id);
      if (generation !== releaseGeneration || !state.open) return;
      state.covers = covers;
      if (covers[0]) await loadCover(covers[0].id);
      else {
        state.coverError = t("该发行版本没有正面封面，保留本地封面。");
        logger.info("metadata", "release_cover_missing", { context: id });
      }
    } catch (error) {
      if (generation === releaseGeneration) reportError("release_covers_failed", error, true);
    } finally {
      if (generation === releaseGeneration) state.loadingCover = false;
    }
  }
  async function loadCover(id: string) {
    const release = state.selected;
    if (!release) return;
    const generation = ++coverGeneration;
    const selectedGeneration = releaseGeneration;
    state.coverId = id;
    state.cover = null;
    state.coverError = "";
    state.loadingCover = true;
    try {
      const data = await options.cover(release.summary.id, id);
      if (generation !== coverGeneration || selectedGeneration !== releaseGeneration || !state.open)
        return;
      state.cover = markRaw(data);
    } catch (error) {
      if (generation === coverGeneration && selectedGeneration === releaseGeneration) {
        reportError("release_cover_failed", error, true);
        state.writeCover = false;
      }
    } finally {
      if (generation === coverGeneration && selectedGeneration === releaseGeneration)
        state.loadingCover = false;
    }
  }
  return {
    loadCovers,
    loadCover,
    invalidate: () => {
      ++releaseGeneration;
      ++coverGeneration;
    },
  };
}

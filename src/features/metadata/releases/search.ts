import type { ReleaseEditorState, ReleaseErrorReporter } from "@/features/metadata/releases/state";
import type { ReleaseEditorOptions } from "@/features/metadata/releases/useEditor";

export function createReleaseSearch(
  state: ReleaseEditorState,
  searchReleases: ReleaseEditorOptions["search"],
  busy: () => boolean,
  reportError: ReleaseErrorReporter,
) {
  let searchGeneration = 0;
  let searched = { artist: "", album: "" };
  function search() {
    if (busy() || state.searching) return;
    searched = { artist: state.artist, album: state.album };
    return searchPage(0);
  }
  function loadMore() {
    return searchPage(state.offset + 25);
  }
  async function searchPage(page: number) {
    if (busy() || state.searching) return;
    const generation = ++searchGeneration;
    state.searching = true;
    state.error = "";
    try {
      const results = await searchReleases(searched.artist, searched.album, page);
      if (generation !== searchGeneration || !state.open) return;
      state.candidates = page > 0 ? [...state.candidates, ...results.releases] : results.releases;
      state.count = results.count;
      state.offset = results.offset;
      state.hasSearched = true;
    } catch (error) {
      if (generation === searchGeneration) reportError("release_search_failed", error);
    } finally {
      if (generation === searchGeneration) state.searching = false;
    }
  }
  return {
    search,
    loadMore,
    invalidate: () => {
      ++searchGeneration;
    },
  };
}

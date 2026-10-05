import { loadSourceModules } from "../../support/moduleLoader";

export function loadPlaylistModules(modules: Record<string, unknown>) {
  return loadSourceModules(
    ["features/playlist/composables/usePlaylist.ts", "features/playlist/pages/PlaylistPage.vue"],
    modules,
  );
}

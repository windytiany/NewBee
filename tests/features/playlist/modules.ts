import { loadSourceModules } from "../../support/module/loader";

export function loadPlaylistModules(modules: Record<string, unknown>) {
  return loadSourceModules(
    ["features/playlist/composables/usePlaylist.ts", "features/playlist/pages/PlaylistPage.vue"],
    modules,
  );
}

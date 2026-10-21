import { loadSourceModules } from "../../support/module/loader";

export function loadPlaylistModules(modules: Record<string, unknown>) {
  return loadSourceModules(
    ["features/playlist/usePlaylist.ts", "features/playlist/PlaylistPage.vue"],
    modules,
  );
}

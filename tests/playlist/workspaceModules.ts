import { loadSourceModules } from "../support/moduleLoader";

export function loadPlaylistWorkspaceModules(modules: Record<string, unknown>) {
  return loadSourceModules(
    [
      "playlist/usePlaylistWorkspace.ts",
      "playlist/ui/PlaylistWorkspaceContent.vue",
      "playlist/ui/PlaylistWorkspaceDialogs.vue",
    ],
    modules,
  );
}

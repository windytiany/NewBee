import { loadSourceModules } from "../support/moduleLoader";

export function loadLibraryWorkspaceModules(modules: Record<string, unknown>) {
  return loadSourceModules(
    [
      "library/useLibraryWorkspace.ts",
      "library/ui/LibraryWorkspaceContent.vue",
      "library/ui/LibraryWorkspaceDialogs.vue",
    ],
    modules,
  );
}

import { loadSourceModules } from "../../support/module/loader";

export function loadLibraryModules(modules: Record<string, unknown>) {
  return loadSourceModules(
    ["features/library/useLibrary.ts", "features/library/LibraryPage.vue"],
    modules,
  );
}

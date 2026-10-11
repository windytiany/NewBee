import { loadSourceModules } from "../../support/module/loader";

export function loadLibraryModules(modules: Record<string, unknown>) {
  return loadSourceModules(
    ["features/library/composables/useLibrary.ts", "features/library/pages/LibraryPage.vue"],
    modules,
  );
}

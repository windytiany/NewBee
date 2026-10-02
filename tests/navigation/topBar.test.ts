import { expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "../support/moduleLoader";
import { pageNames } from "@/navigation/types";
import type { BrandMenuAction } from "@/navigation/types";

type Dialog = { show: () => void };
type Bindings = {
  libraryScanDialog: Vue.Ref<Dialog | null>;
  pathMigrationDialog: Vue.Ref<Dialog | null>;
  settingsDialog: Vue.Ref<Dialog | null>;
  onBrandMenuSelect: (action: BrandMenuAction) => Promise<void>;
};

const output = compileSfc(
  await Bun.file(new URL("../../src/navigation/TopBar.vue", import.meta.url)).text(),
  "src/navigation/TopBar.vue",
  { inlineTemplate: false },
);

it("routes brand menu selections to existing import and dialog actions", async () => {
  const actions: string[] = [];
  const modules: Record<string, unknown> = {
    vue: { ...Vue, onMounted: () => {}, onUnmounted: () => {} },
    "@tauri-apps/api/core": { isTauri: () => false },
    "@tauri-apps/api/window": { getCurrentWindow: () => null },
    "@lucide/vue": { Copy: {}, Maximize: {}, Minus: {}, X: {} },
    "@/navigation/BrandMenu.vue": { default: {} },
    "@/navigation/types": { pageNames },
    "@/library/ui/LibraryScanDialog.vue": { default: {} },
    "@/library/ui/PathMigrationDialog.vue": { default: {} },
    "@/settings/ui/SettingsDialog.vue": { default: {} },
    "@/library/fileImport": {
      useLibraryFileImport: () => ({
        isImporting: Vue.ref(false),
        importMusicFiles: async () => {
          actions.push("import");
        },
      }),
    },
  };
  const component = evaluateModule<{
    default: { setup: (props: object, context: object) => Bindings };
  }>(output, modules).default;
  const bindings = component.setup({ activePage: "Library" }, { expose: () => {}, emit: () => {} });
  bindings.libraryScanDialog.value = {
    show: () => {
      actions.push("scan");
    },
  };
  bindings.pathMigrationDialog.value = {
    show: () => {
      actions.push("migrate");
    },
  };
  bindings.settingsDialog.value = {
    show: () => {
      actions.push("settings");
    },
  };

  for (const action of ["import", "scan", "migrate", "settings"] as const) {
    await bindings.onBrandMenuSelect(action);
  }

  expect(actions).toEqual(["import", "scan", "migrate", "settings"]);
});

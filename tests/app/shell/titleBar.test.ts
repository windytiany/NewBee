import { expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";

import { pageNames, pageLabel } from "@/app/pages";
import type { AppMenuAction } from "@/app/shell/AppMenu.vue";

type Dialog = { show: () => void };
type Bindings = {
  libraryScanDialog: Vue.Ref<Dialog | null>;
  pathMigrationDialog: Vue.Ref<Dialog | null>;
  settingsDialog: Vue.Ref<Dialog | null>;
  onMenuSelect: (action: AppMenuAction) => Promise<void>;
};

const output = compileSfc(
  await Bun.file(new URL("../../../src/app/shell/TitleBar.vue", import.meta.url)).text(),
  "src/app/shell/TitleBar.vue",
  { inlineTemplate: false },
);

it("routes brand menu selections to existing import and dialog actions", async () => {
  const actions: string[] = [];
  const modules: Record<string, unknown> = {
    vue: { ...Vue, onMounted: () => {}, onUnmounted: () => {} },
    "@tauri-apps/api/core": { isTauri: () => false },
    "@tauri-apps/api/window": { getCurrentWindow: () => null },
    "@lucide/vue": { Copy: {}, Maximize: {}, Minus: {}, X: {} },
    "@/app/shell/AppMenu.vue": { default: {} },
    "@/app/pages": { pageNames, pageLabel },
    "@/features/library/import/ScanDialog.vue": { default: {} },
    "@/features/library/paths/PathMigrationDialog.vue": { default: {} },
    "@/features/settings/components/SettingsDialog.vue": { default: {} },
    "@/features/library/import/useFileImport": {
      useLibraryFileImport: () => ({
        isImporting: Vue.ref(false),
        importMusicFiles: async () => {
          actions.push("import");
        },
      }),
    },
  };
  const component = evaluateSource<{
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
    await bindings.onMenuSelect(action);
  }

  expect(actions).toEqual(["import", "scan", "migrate", "settings"]);
});

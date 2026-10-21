import { expect, it } from "bun:test";
import * as Vue from "vue";
import * as Icons from "@lucide/vue";
import { createHostNode, createHostRenderer, findNode } from "../../support/host/renderer";
import { compileSfc, evaluateSource } from "../../support/module/loader";

import { pageNames, pageLabel } from "@/app/pages";
import type { AppMenuAction } from "@/app/shell/AppMenu.vue";

type Dialog = { show: () => void };
type Bindings = {
  libraryScanDialog: Vue.Ref<Dialog | null>;
  importDialog: Vue.Ref<{ show: (inbox: boolean) => void } | null>;
  pathRemappingDialog: Vue.Ref<Dialog | null>;
  settingsDialog: Vue.Ref<{ show: (category?: "advanced") => void } | null>;
  showSettings: (category?: "advanced") => Promise<void>;
  onMenuSelect: (action: AppMenuAction) => Promise<void>;
};

const output = compileSfc(
  await Bun.file(new URL("../../../src/app/shell/TitleBar.vue", import.meta.url)).text(),
  "src/app/shell/TitleBar.vue",
  { inlineTemplate: false },
);

it("lays out task progress before window controls without overlapping absolute positioning", async () => {
  const filename = "src/app/shell/TitleBar.vue";
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(await Bun.file(filename).text(), filename),
    {
      vue: Vue,
      "@lucide/vue": Icons,
      "@/app/shell/useWindow": {
        useWindow: () => ({ isTauriApp: true, isMaximized: Vue.ref(false) }),
      },
      "@/shared/tasks/TaskEntry.vue": {
        render: () => Vue.h("button", { "data-task-entry": true }, "32%"),
      },
      "@/app/shell/AppMenu.vue": { render: () => null },
      "@/app/shell/PageTabs.vue": { render: () => null },
      "@/features/library/synchronization/ScanDialog.vue": { render: () => null },
      "@/app/import/ImportDialog.vue": { render: () => null },
      "@/features/remapping/PathRemappingDialog.vue": { render: () => null },
      "@/features/settings/SettingsDialog.vue": { render: () => null },
      "@/features/inbox/useImport": { useInboxImport: () => ({ pending: Vue.ref(false) }) },
      "@/features/library/import/useFileImport": {
        useLibraryFileImport: () => ({ isImporting: Vue.ref(false) }),
      },
    },
  ).default;
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(component, { activePage: "Library" });
  app.mount(root);
  try {
    const task = findNode(root, (node) => node.props["data-task-entry"] === true)!;
    const controls = findNode(root, (node) => node.props["aria-label"] === "窗口控制")!;
    expect(controls.parent).toBe(task.parent);
    expect(task.parent!.children.indexOf(task)).toBeLessThan(
      task.parent!.children.indexOf(controls),
    );
    expect(String(controls.props.class).split(" ")).not.toContain("absolute");
    expect(String(task.parent!.props.class)).toContain("flex");
    expect(String(task.parent!.props.class)).toContain("inset-y-0");
    expect(String(task.parent!.props.class)).toContain("right-0");
  } finally {
    app.unmount();
  }
});

it("routes brand menu selections to existing import and dialog actions", async () => {
  const actions: string[] = [];
  const modules: Record<string, unknown> = {
    vue: { ...Vue, onMounted: () => {}, onUnmounted: () => {} },
    "@tauri-apps/api/core": { isTauri: () => false },
    "@tauri-apps/api/window": { getCurrentWindow: () => null },
    "@lucide/vue": { Copy: {}, Maximize: {}, Minus: {}, X: {} },
    "@/app/shell/AppMenu.vue": { default: {} },
    "@/app/pages": { pageNames, pageLabel },
    "@/features/library/synchronization/ScanDialog.vue": { default: {} },
    "@/app/import/ImportDialog.vue": { default: {} },
    "@/features/inbox/useImport": { useInboxImport: () => ({ pending: Vue.ref(false) }) },
    "@/features/remapping/PathRemappingDialog.vue": { default: {} },
    "@/features/settings/SettingsDialog.vue": { default: {} },
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
  bindings.importDialog.value = {
    show: (inbox) => {
      expect(inbox).toBe(false);
      actions.push("import");
    },
  };
  bindings.libraryScanDialog.value = {
    show: () => {
      actions.push("scan");
    },
  };
  bindings.pathRemappingDialog.value = {
    show: () => {
      actions.push("remap");
    },
  };
  bindings.settingsDialog.value = {
    show: () => {
      actions.push("settings");
    },
  };

  for (const action of ["import", "scan", "remap", "settings"] as const) {
    await bindings.onMenuSelect(action);
  }

  expect(actions).toEqual(["import", "scan", "remap", "settings"]);
  let category: string | undefined;
  bindings.settingsDialog.value = {
    show: (selected) => {
      category = selected;
    },
  };
  await bindings.showSettings("advanced");
  expect(category).toBe("advanced");
});

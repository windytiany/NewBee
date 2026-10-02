// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { NotificationInput } from "@/notification/center";

const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const dialogSource = await bunRuntime.Bun.file(
  new URL("../src/library/ui/PathMigrationDialog.vue", import.meta.url),
).text();
const topBarSource = await bunRuntime.Bun.file(
  new URL("../src/navigation/TopBar.vue", import.meta.url),
).text();

function compile(source: string, filename: string) {
  const { descriptor } = parse(source, { filename });
  const script = compileScript(descriptor, { id: filename });
  return transpileModule(script.content, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
}
const dialogOutput = compile(dialogSource, "src/library/ui/PathMigrationDialog.vue");
const topBarOutput = compile(topBarSource, "src/navigation/TopBar.vue");

type DialogBindings = {
  dialogElement: Vue.Ref<{ open: boolean; showModal: () => void; close: () => void }>;
  oldPath: Vue.Ref<string>;
  newPath: Vue.Ref<string>;
  isMigrating: Vue.Ref<boolean>;
  show: () => void;
  close: () => void;
  migrate: () => Promise<void>;
};

function createDialog(
  invoke: (command: string, args: unknown) => Promise<unknown>,
  isTauriApp = true,
) {
  const notices: NotificationInput[] = [];
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@tauri-apps/api/core": { invoke, isTauri: () => isTauriApp },
    "@/notification/center": { notify: (notice: NotificationInput) => notices.push(notice) },
  };
  const module = {
    exports: {} as { default: { setup: (props: object, context: object) => DialogBindings } },
  };
  new Function("require", "module", "exports", dialogOutput)(
    (name: string) => modules[name],
    module,
    module.exports,
  );
  const bindings = module.exports.default.setup({}, { expose: () => {} });
  const element = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
  bindings.dialogElement.value = element;
  bindings.show();
  bindings.oldPath.value = "C:\\Music\\";
  bindings.newPath.value = "D:\\Music\\";
  return { bindings, element, notices };
}

describe("path migration dialog", () => {
  it("sends both prefixes, reports the count, and closes after success", async () => {
    const calls: unknown[] = [];
    const { bindings, element, notices } = createDialog(async (command, args) => {
      calls.push([command, args]);
      return 12;
    });
    bindings.oldPath.value = " C:\\Music\\ ";
    await bindings.migrate();
    expect(calls).toEqual([
      ["migrate_track_paths", { oldPath: "C:\\Music\\", newPath: "D:\\Music\\" }],
    ]);
    expect(notices[0]?.type).toBe("success");
    expect(notices[0]?.message).toContain("12");
    expect(element.open).toBe(false);
  });

  it("keeps the dialog and input when no tracks match", async () => {
    const { bindings, element, notices } = createDialog(async () => 0);
    await bindings.migrate();
    expect(notices[0]?.type).toBe("info");
    expect(element.open).toBe(true);
    expect(bindings.oldPath.value).toBe("C:\\Music\\");
  });

  it("retains input and permits retry after a backend conflict", async () => {
    let calls = 0;
    const { bindings, element, notices } = createDialog(async () => {
      if (++calls === 1) throw new Error("路径冲突");
      return 1;
    });
    await bindings.migrate();
    expect(notices[0]?.type).toBe("error");
    expect(notices[0]?.message).toContain("路径冲突");
    expect(element.open).toBe(true);
    expect(bindings.isMigrating.value).toBe(false);
    expect(bindings.newPath.value).toBe("D:\\Music\\");
    await bindings.migrate();
    expect(element.open).toBe(false);
  });

  it("does not invoke migration for empty or identical prefixes", async () => {
    let calls = 0;
    const { bindings, notices } = createDialog(async () => ++calls);
    bindings.oldPath.value = "  ";
    await bindings.migrate();
    bindings.oldPath.value = bindings.newPath.value;
    await bindings.migrate();
    expect(calls).toBe(0);
    expect(notices.map((notice) => notice.type)).toEqual(["warning", "warning"]);
  });

  it("blocks duplicate submits, closing and resetting while migration is pending", async () => {
    let resolve!: (count: number) => void;
    let calls = 0;
    const pending = new Promise<number>((finish) => {
      resolve = finish;
    });
    const { bindings, element } = createDialog(() => {
      calls++;
      return pending;
    });
    const migration = bindings.migrate();
    await bindings.migrate();
    bindings.close();
    bindings.show();
    expect(calls).toBe(1);
    expect(element.open).toBe(true);
    expect(bindings.oldPath.value).toBe("C:\\Music\\");
    resolve(2);
    await migration;
    expect(element.open).toBe(false);
  });

  it("cancel does not invoke migration and reopening clears unsaved input", () => {
    let calls = 0;
    const { bindings, element } = createDialog(async () => ++calls);
    bindings.close();
    expect(element.open).toBe(false);
    bindings.show();
    expect(bindings.oldPath.value).toBe("");
    expect(bindings.newPath.value).toBe("");
    expect(calls).toBe(0);
  });

  it("does not invoke desktop APIs in browser preview", async () => {
    let calls = 0;
    const { bindings } = createDialog(async () => ++calls, false);
    await bindings.migrate();
    expect(calls).toBe(0);
  });
});

describe("brand menu path migration entry", () => {
  it("places migration above settings", () => {
    const { descriptor } = parse(topBarSource);
    const template = descriptor.template!.content;
    expect(template.indexOf('@click="openScanDialog"')).toBeLessThan(
      template.indexOf('@click="openPathMigrationDialog"'),
    );
    expect(template.indexOf('@click="openPathMigrationDialog"')).toBeLessThan(
      template.indexOf('@click="openSettingsDialog"'),
    );
    expect(template).toContain('<PathMigrationDialog ref="pathMigrationDialog" />');
  });

  it("closes the menu and restores focus before opening the dialog", async () => {
    type Bindings = {
      isBrandMenuOpen: Vue.Ref<boolean>;
      brandButton: Vue.Ref<{ focus: () => void }>;
      pathMigrationDialog: Vue.Ref<{ show: () => void }>;
      openPathMigrationDialog: () => Promise<void>;
    };
    const modules: Record<string, unknown> = {
      vue: { ...Vue, onMounted: () => {}, onUnmounted: () => {} },
      "@tauri-apps/api/core": { isTauri: () => false },
      "@tauri-apps/api/window": {},
      "@/library/ui/LibraryScanDialog.vue": {},
      "@/library/ui/PathMigrationDialog.vue": {},
      "@/settings/ui/SettingsDialog.vue": {},
      "@/types/page": { pageNames: [] },
      "@lucide/vue": {},
    };
    const module = {
      exports: {} as { default: { setup: (props: object, context: object) => Bindings } },
    };
    new Function("require", "module", "exports", topBarOutput)(
      (name: string) => modules[name],
      module,
      module.exports,
    );
    const bindings = module.exports.default.setup(
      { activePage: "Library" },
      { expose: () => {}, emit: () => {} },
    );
    const events: string[] = [];
    bindings.isBrandMenuOpen.value = true;
    bindings.brandButton.value = { focus: () => events.push("focus") };
    bindings.pathMigrationDialog.value = { show: () => events.push("show") };
    await bindings.openPathMigrationDialog();
    expect(bindings.isBrandMenuOpen.value).toBe(false);
    expect(events).toEqual(["focus", "show"]);
  });
});

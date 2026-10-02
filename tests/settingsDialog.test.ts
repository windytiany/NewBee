// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

type Settings = { closeBehavior: "tray" | "exit" };
type DialogBindings = {
  dialogElement: Vue.Ref<{ open: boolean; showModal: () => void; close: () => void }>;
  closeBehavior: Vue.Ref<Settings["closeBehavior"]>;
  error: Vue.Ref<string>;
  isLoaded: Vue.Ref<boolean>;
  isLoading: Vue.Ref<boolean>;
  show: () => Promise<void>;
  close: () => void;
  save: () => Promise<void>;
};
const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const filename = "src/settings/ui/SettingsDialog.vue";
const { descriptor } = parse(
  await bunRuntime.Bun.file(
    new URL("../src/settings/ui/SettingsDialog.vue", import.meta.url),
  ).text(),
  { filename },
);
const script = compileScript(descriptor, { id: "settings-dialog-test" });
const output = transpileModule(script.content, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
}).outputText;

function createDialog(invoke: (command: string, args?: unknown) => Promise<unknown>) {
  const module = {
    exports: {} as { default: { setup: (props: object, context: object) => DialogBindings } },
  };
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@tauri-apps/api/core": { invoke, isTauri: () => true },
  };
  new Function("require", "module", "exports", output)(
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
  return { bindings, element };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("settings dialog", () => {
  it("loads the saved behavior and saves the selection before closing", async () => {
    const calls: Array<[string, unknown]> = [];
    const { bindings, element } = createDialog(async (command, args) => {
      calls.push([command, args]);
      return command === "get_settings" ? { closeBehavior: "exit" } : undefined;
    });
    await bindings.show();
    expect(bindings.closeBehavior.value).toBe("exit");
    expect(element.open).toBe(true);
    bindings.closeBehavior.value = "tray";
    await bindings.save();
    expect(calls).toEqual([
      ["get_settings", undefined],
      ["save_settings", { settings: { closeBehavior: "tray" } }],
    ]);
    expect(element.open).toBe(false);
  });

  it("cancel does not save and reopening discards unsaved changes", async () => {
    const calls: string[] = [];
    const { bindings } = createDialog(async (command) => {
      calls.push(command);
      return { closeBehavior: "tray" };
    });
    await bindings.show();
    bindings.closeBehavior.value = "exit";
    bindings.close();
    await bindings.show();
    expect(bindings.closeBehavior.value).toBe("tray");
    expect(calls).toEqual(["get_settings", "get_settings"]);
  });

  it("blocks saving when loading fails", async () => {
    const calls: string[] = [];
    const { bindings, element } = createDialog(async (command) => {
      calls.push(command);
      throw new Error("Unavailable");
    });
    await bindings.show();
    await bindings.save();
    expect(bindings.error.value).toContain("读取配置失败");
    expect(bindings.isLoaded.value).toBe(false);
    expect(element.open).toBe(true);
    expect(calls).toEqual(["get_settings"]);
  });

  it("keeps the dialog open and reports save failures", async () => {
    const { bindings, element } = createDialog(async (command) => {
      if (command === "get_settings") return { closeBehavior: "tray" };
      throw new Error("Disk unavailable");
    });
    await bindings.show();
    await bindings.save();
    expect(element.open).toBe(true);
    expect(bindings.error.value).toContain("Disk unavailable");
  });

  it("ignores stale loads after the dialog is reopened", async () => {
    const first = deferred<Settings>();
    const second = deferred<Settings>();
    let calls = 0;
    const { bindings } = createDialog(() => (++calls === 1 ? first.promise : second.promise));
    const firstShow = bindings.show();
    bindings.close();
    const secondShow = bindings.show();
    first.resolve({ closeBehavior: "exit" });
    await firstShow;
    expect(bindings.isLoading.value).toBe(true);
    expect(bindings.isLoaded.value).toBe(false);
    second.resolve({ closeBehavior: "tray" });
    await secondShow;
    expect(bindings.closeBehavior.value).toBe("tray");
    expect(bindings.isLoading.value).toBe(false);
  });

  it("blocks duplicate saves and closing during a save", async () => {
    const saving = deferred<void>();
    let saves = 0;
    const { bindings, element } = createDialog(async (command) => {
      if (command === "get_settings") return { closeBehavior: "tray" };
      saves++;
      return saving.promise;
    });
    await bindings.show();
    const pending = bindings.save();
    await bindings.save();
    bindings.close();
    expect(saves).toBe(1);
    expect(element.open).toBe(true);
    saving.resolve();
    await pending;
    expect(element.open).toBe(false);
  });
});

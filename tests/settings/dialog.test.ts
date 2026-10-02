import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "../support/moduleLoader";
import { SETTINGS_CHANGED_EVENT, type Settings } from "@/settings/types";
import { THEMES } from "@/settings/theme";

type DialogBindings = {
  dialogElement: Vue.Ref<{ open: boolean; showModal: () => void; close: () => void }>;
  closeBehavior: Vue.Ref<Settings["closeBehavior"]>;
  theme: Vue.Ref<Settings["theme"]>;
  albumSortBy: Vue.Ref<Settings["albumSortBy"]>;
  albumSortOrder: Vue.Ref<Settings["albumSortOrder"]>;
  error: Vue.Ref<string>;
  isLoaded: Vue.Ref<boolean>;
  isLoading: Vue.Ref<boolean>;
  show: () => Promise<void>;
  close: () => void;
  save: () => Promise<void>;
};
const defaults: Settings = {
  theme: "spotify",
  closeBehavior: "tray",
  albumSortBy: "name",
  albumSortOrder: "ascending",
};

const filename = "src/settings/ui/SettingsDialog.vue";
const output = compileSfc(
  await Bun.file(new URL("../../src/settings/ui/SettingsDialog.vue", import.meta.url)).text(),
  filename,
  { id: "settings-dialog-test", inlineTemplate: false },
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function createDialog(invoke: (command: string, args?: unknown) => Promise<unknown>) {
  const events: string[] = [];
  const appliedThemes: Settings["theme"][] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (event: Event) => events.push(event.type) },
  });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@tauri-apps/api/core": { invoke, isTauri: () => true },
    "@/settings/types": { SETTINGS_CHANGED_EVENT },
    "@/settings/theme": {
      THEMES,
      applyTheme: (theme: Settings["theme"]) => appliedThemes.push(theme),
    },
  };
  const component = evaluateModule<{
    default: { setup: (props: object, context: object) => DialogBindings };
  }>(output, modules).default;
  const bindings = component.setup({}, { expose: () => {} });
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
  return { bindings, element, events, appliedThemes };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("settings dialog", () => {
  for (const option of THEMES) {
    it(`persists and applies ${option.value} only after saving`, async () => {
      const calls: unknown[] = [];
      const { bindings, appliedThemes } = createDialog(async (command, args) => {
        if (command === "get_settings") return defaults;
        calls.push(args);
      });
      await bindings.show();
      bindings.theme.value = option.value;
      expect(appliedThemes).toEqual([]);
      await bindings.save();
      expect(calls).toEqual([{ settings: { ...defaults, theme: option.value } }]);
      expect(appliedThemes).toEqual([option.value]);
    });
  }

  it("loads and saves all settings and notifies the library after saving", async () => {
    const calls: Array<[string, unknown]> = [];
    const loaded: Settings = {
      theme: "tokyoNight",
      closeBehavior: "exit",
      albumSortBy: "year",
      albumSortOrder: "descending",
    };
    const { bindings, element, events } = createDialog(async (command, args) => {
      calls.push([command, args]);
      return command === "get_settings" ? loaded : undefined;
    });
    await bindings.show();
    expect(bindings.closeBehavior.value).toBe("exit");
    expect(bindings.theme.value).toBe("tokyoNight");
    expect(bindings.albumSortBy.value).toBe("year");
    expect(bindings.albumSortOrder.value).toBe("descending");
    expect(element.open).toBe(true);
    expect(events).toEqual([]);
    bindings.theme.value = "spotify";
    bindings.closeBehavior.value = "tray";
    bindings.albumSortBy.value = "name";
    bindings.albumSortOrder.value = "ascending";
    await bindings.save();
    expect(calls).toEqual([
      ["get_settings", undefined],
      ["save_settings", { settings: defaults }],
    ]);
    expect(events).toEqual([SETTINGS_CHANGED_EVENT]);
    expect(element.open).toBe(false);
  });

  it("cancel does not save or notify and reopening discards unsaved changes", async () => {
    const calls: string[] = [];
    const { bindings, events, appliedThemes } = createDialog(async (command) => {
      calls.push(command);
      return defaults;
    });
    await bindings.show();
    bindings.closeBehavior.value = "exit";
    bindings.albumSortBy.value = "year";
    bindings.albumSortOrder.value = "descending";
    bindings.theme.value = "catppuccin";
    bindings.close();
    await bindings.show();
    expect<Settings["theme"]>(bindings.theme.value).toBe("spotify");
    expect(appliedThemes).toEqual([]);
    expect<Settings["closeBehavior"]>(bindings.closeBehavior.value).toBe("tray");
    expect<Settings["albumSortBy"]>(bindings.albumSortBy.value).toBe("name");
    expect<Settings["albumSortOrder"]>(bindings.albumSortOrder.value).toBe("ascending");
    expect(calls).toEqual(["get_settings", "get_settings"]);
    expect(events).toEqual([]);
  });

  it("blocks saving when loading fails", async () => {
    const calls: string[] = [];
    const { bindings, element, events } = createDialog(async (command) => {
      calls.push(command);
      throw new Error("Unavailable");
    });
    await bindings.show();
    await bindings.save();
    expect(bindings.error.value).toContain("读取配置失败");
    expect(bindings.isLoaded.value).toBe(false);
    expect(element.open).toBe(true);
    expect(calls).toEqual(["get_settings"]);
    expect(events).toEqual([]);
  });

  it("keeps the dialog open and does not notify after save failures", async () => {
    const { bindings, element, events, appliedThemes } = createDialog(async (command) => {
      if (command === "get_settings") return defaults;
      throw new Error("Disk unavailable");
    });
    await bindings.show();
    await bindings.save();
    expect(element.open).toBe(true);
    expect(bindings.error.value).toContain("Disk unavailable");
    expect(appliedThemes).toEqual([]);
    expect(events).toEqual([]);
  });

  it("ignores stale loads after the dialog is reopened", async () => {
    const first = deferred<Settings>();
    const second = deferred<Settings>();
    let calls = 0;
    const { bindings } = createDialog(() => (++calls === 1 ? first.promise : second.promise));
    const firstShow = bindings.show();
    bindings.close();
    const secondShow = bindings.show();
    first.resolve({
      theme: "tokyoNight",
      closeBehavior: "exit",
      albumSortBy: "year",
      albumSortOrder: "descending",
    });
    await firstShow;
    expect(bindings.isLoading.value).toBe(true);
    expect(bindings.isLoaded.value).toBe(false);
    second.resolve(defaults);
    await secondShow;
    expect(bindings.closeBehavior.value).toBe("tray");
    expect(bindings.albumSortBy.value).toBe("name");
    expect(bindings.albumSortOrder.value).toBe("ascending");
    expect(bindings.isLoading.value).toBe(false);
  });

  it("blocks duplicate saves and closing during a save", async () => {
    const saving = deferred<void>();
    let saves = 0;
    const { bindings, element, events } = createDialog(async (command) => {
      if (command === "get_settings") return defaults;
      saves++;
      return saving.promise;
    });
    await bindings.show();
    const pending = bindings.save();
    await bindings.save();
    bindings.close();
    expect(saves).toBe(1);
    expect(element.open).toBe(true);
    expect(events).toEqual([]);
    saving.resolve();
    await pending;
    expect(element.open).toBe(false);
    expect(events).toEqual([SETTINGS_CHANGED_EVENT]);
  });
});

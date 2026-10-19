import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { locale, setLocale } from "@/shared/i18n/locale";
import { compileSfc, evaluateSource } from "../../support/module/loader";

import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/host/renderer";
import type { HostNode } from "../../support/host/renderer";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { Settings } from "@/features/settings/types";
import {
  cloneShortcuts,
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  formatShortcut,
  allowsGlobalShortcut,
} from "@/features/shortcuts/bindings";
import * as AccentColor from "@/features/settings/accent";
import { BINDING_GROUPS } from "@/features/shortcuts/groups";
import type { NotificationInput } from "@/shared/notifications/center";

type DialogBindings = {
  dialogElement: Vue.Ref<{ open: boolean; showModal: () => void; close: () => void }>;
  selectedCategory: Vue.Ref<
    | "general"
    | "appearance"
    | "playback"
    | "library"
    | "lyrics"
    | "shortcuts"
    | "advanced"
    | "about"
  >;
  shortcuts: Vue.Ref<Settings["shortcuts"]>;
  selectedShortcutAction: Vue.Ref<ShortcutAction>;
  detailedLogging: Vue.Ref<boolean>;
  isChangingLogging: Vue.Ref<boolean>;
  changeLogging: () => Promise<void>;
  openLogs: () => Promise<void>;
  neteaseEnabled: Vue.Ref<boolean>;
  neteaseLyricsMode: Vue.Ref<Settings["neteaseLyricsMode"]>;
  selectedLocale: Vue.Ref<Settings["locale"]>;
  closeBehavior: Vue.Ref<Settings["closeBehavior"]>;
  lightweightOnClose: Vue.Ref<boolean>;
  themeMode: Vue.Ref<Settings["themeMode"]>;
  accentColor: Vue.Ref<Settings["accentColor"]>;
  reducedMotion: Vue.Ref<boolean>;
  layoutDensity: Vue.Ref<Settings["layoutDensity"]>;
  albumCoverBackground: Vue.Ref<boolean>;
  playingCoverBackground: Vue.Ref<boolean>;
  showPlaybackStatistics: Vue.Ref<boolean>;
  replayGain: Vue.Ref<boolean>;
  replayGainPreamp: Vue.Ref<number>;
  scanReplayGain: Vue.Ref<boolean>;
  monitoringFolders: Vue.Ref<Settings["monitoringFolders"]>;
  albumSortBy: Vue.Ref<Settings["albumSortBy"]>;
  albumSortOrder: Vue.Ref<Settings["albumSortOrder"]>;
  isLoaded: Vue.Ref<boolean>;
  isLoading: Vue.Ref<boolean>;
  isBackingUp: Vue.Ref<boolean>;
  show: (category?: "about") => Promise<void>;
  close: () => void;
  save: () => Promise<void>;
  resetShortcuts: () => void;
  recordShortcut: (event: KeyboardEvent) => void;
};
const defaults: Settings = {
  themeMode: "system",
  locale: "zh-CN",
  accentColor: AccentColor.DEFAULT_ACCENT_COLOR,
  reducedMotion: false,
  layoutDensity: "regular",
  albumCoverBackground: false,
  playingCoverBackground: false,
  closeBehavior: "tray",
  lightweightOnClose: false,
  showPlaybackStatistics: true,
  replayGain: true,
  replayGainPreamp: 0,
  scanReplayGain: false,
  monitoringFolders: [],
  albumSortBy: "name",
  albumSortOrder: "ascending",
  lyricsProviders: ["netease"],
  neteaseLyricsMode: "original",
  shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS),
};

const icon = Vue.defineComponent({ setup: () => () => Vue.h("svg") });
const icons = { RotateCcw: icon, Undo2: icon };
const filename = "src/features/settings/components/SettingsDialog.vue";
const source = await Bun.file(
  new URL("../../../src/features/settings/components/SettingsDialog.vue", import.meta.url),
).text();
const output = compileSfc(source, filename, { id: "settings-dialog-test", inlineTemplate: false });
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  setLocale("zh-CN");
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function createDialog(
  invoke: (command: string, args?: unknown) => Promise<unknown>,
  suspend: (suspended: boolean) => Promise<void> = async () => {},
  lifecycle: { confirm?: () => Promise<boolean>; idle?: () => Promise<void> } = {},
) {
  let releaseGuard: ((signal: AbortSignal) => Promise<boolean>) | undefined;
  const events: string[] = [];
  const suspensions: boolean[] = [];
  const feedback: NotificationInput[] = [];
  const appliedThemes: Settings["themeMode"][] = [];
  const appliedColors: Settings["accentColor"][] = [];
  const appliedMotion: boolean[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (event: Event) => events.push(event.type) },
  });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@lucide/vue": icons,
    "@tauri-apps/plugin-dialog": { ask: lifecycle.confirm ?? (async () => false) },
    "@/shared/lifecycle/activity": {
      watchActivity: () => () => {},
      beforeRelease: (guard: typeof releaseGuard) => {
        releaseGuard = guard;
        return () => {};
      },
      waitForIdle: lifecycle.idle ?? (async () => {}),
    },
    "@/shared/notifications/center": { notify: (input: NotificationInput) => feedback.push(input) },
    "@/features/backup/components/BackupOptions.vue": Vue.defineComponent({ template: "<div />" }),
    "@/features/settings/about/AboutPanel.vue": Vue.defineComponent({ template: "<div />" }),
    "@/features/library/monitoring/MonitoringOptions.vue": Vue.defineComponent({
      template: "<div />",
    }),
    "@tauri-apps/api/core": {
      invoke: async (command: string, args?: unknown) => {
        if (command === "set_shortcuts_suspended") {
          suspensions.push(
            Boolean(args && typeof args === "object" && "suspended" in args && args.suspended),
          );
          await suspend(suspensions[suspensions.length - 1]!);
          return;
        }
        return invoke(command, args);
      },
      isTauri: () => true,
    },
    "@/features/settings/events": { SETTINGS_CHANGED_EVENT },
    "@/features/settings/accent": AccentColor,
    "@/features/settings/appearance": {
      applyAppearance: (settings: Settings) => {
        appliedThemes.push(settings.themeMode);
        appliedColors.push(settings.accentColor);
        appliedMotion.push(settings.reducedMotion);
      },
    },
  };
  const component = evaluateSource<{
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
  return {
    bindings,
    element,
    events,
    appliedThemes,
    appliedColors,
    appliedMotion,
    feedback,
    suspensions,
    prepareRelease: (signal = new AbortController().signal) => releaseGuard!(signal),
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("settings dialog", () => {
  it("opens updates in About and preserves an already open settings draft", async () => {
    let loads = 0;
    const { bindings } = createDialog(async () => {
      loads++;
      return defaults;
    });
    await bindings.show("about");
    expect(bindings.selectedCategory.value).toBe("about");
    expect(loads).toBe(1);
    bindings.selectedCategory.value = "appearance";
    bindings.lightweightOnClose.value = true;
    await bindings.show();
    expect(bindings.selectedCategory.value).toBe("appearance");
    await bindings.show("about");
    expect(bindings.selectedCategory.value).toBe("about");
    expect(bindings.lightweightOnClose.value).toBe(true);
    expect(loads).toBe(1);
  });

  it("defaults lightweight mode off for legacy settings and persists the explicit preference", async () => {
    let saved: Settings | undefined;
    const { bindings } = createDialog(async (command, args) => {
      if (command === "get_settings") return { ...defaults, lightweightOnClose: undefined };
      if (command === "save_settings") saved = (args as { settings: Settings }).settings;
    });
    await bindings.show();
    expect(bindings.lightweightOnClose.value).toBe(false);
    bindings.lightweightOnClose.value = true;
    await bindings.save();
    expect(saved?.lightweightOnClose).toBe(true);
  });

  it("requires confirmation before discarding settings for lightweight mode", async () => {
    let confirmations = 0;
    let discard = false;
    const dialog = createDialog(async () => defaults, undefined, {
      confirm: async () => {
        confirmations++;
        return discard;
      },
    });
    await dialog.bindings.show();
    dialog.bindings.lightweightOnClose.value = true;
    expect(await dialog.prepareRelease()).toBe(false);
    expect(dialog.element.open).toBe(true);
    discard = true;
    expect(await dialog.prepareRelease()).toBe(true);
    expect(dialog.element.open).toBe(false);
    expect(confirmations).toBe(2);
    expect(dialog.suspensions[dialog.suspensions.length - 1]).toBe(false);
  });

  it("closes an unchanged settings dialog without a discard warning", async () => {
    let confirmations = 0;
    const dialog = createDialog(async () => defaults, undefined, {
      confirm: async () => {
        confirmations++;
        return true;
      },
    });
    await dialog.bindings.show();
    expect(await dialog.prepareRelease()).toBe(true);
    expect(confirmations).toBe(0);
    expect(dialog.element.open).toBe(false);
  });

  it("keeps the settings draft when the window reopens during confirmation", async () => {
    const confirmation = deferred<boolean>();
    const dialog = createDialog(async () => defaults, undefined, {
      confirm: () => confirmation.promise,
    });
    await dialog.bindings.show();
    dialog.bindings.lightweightOnClose.value = true;
    const controller = new AbortController();
    const preparing = dialog.prepareRelease(controller.signal);
    await Promise.resolve();
    controller.abort();
    confirmation.resolve(true);
    expect(await preparing).toBe(false);
    expect(dialog.element.open).toBe(true);
  });

  it("keeps monitoring folders as a draft and saves them independently of scan directories", async () => {
    const persisted: Settings = {
      ...defaults,
      monitoringFolders: [{ path: "D:/Music", mode: "startup", enabled: true }],
    };
    const calls: string[] = [];
    let saved: Settings | undefined;
    const { bindings } = createDialog(async (command, args) => {
      calls.push(command);
      if (command === "get_settings") return persisted;
      if (command === "save_settings") saved = (args as { settings: Settings }).settings;
    });
    await bindings.show();
    bindings.selectedCategory.value = "library";
    bindings.monitoringFolders.value[0]!.mode = "continuous";
    expect(persisted.monitoringFolders[0]!.mode).toBe("startup");
    bindings.close();
    await bindings.show();
    expect(bindings.monitoringFolders.value).toEqual(persisted.monitoringFolders);
    bindings.monitoringFolders.value = [{ path: "D:/Other", mode: "continuous", enabled: false }];
    await bindings.save();
    expect(saved?.monitoringFolders).toEqual([
      { path: "D:/Other", mode: "continuous", enabled: false },
    ]);
    expect(calls).not.toContain("add_music_library_directory");
    expect(calls).not.toContain("scan_music_library");
  });
  it("restores the draft immediately, discards it on cancel and persists only on save", async () => {
    const persisted = { ...defaults, shortcuts: cloneShortcuts({}) };
    const saved: Settings[] = [];
    const { bindings } = createDialog(async (command, args) => {
      if (command === "get_settings") return persisted;
      if (command === "save_settings") saved.push((args as { settings: Settings }).settings);
    });
    await bindings.show();
    expect(bindings.shortcuts.value.togglePlayback.shortcut).toBe("");
    bindings.resetShortcuts();
    expect(saved).toEqual([]);
    bindings.close();
    await bindings.show();
    expect(bindings.shortcuts.value.togglePlayback.shortcut).toBe("");
    bindings.resetShortcuts();
    expect(bindings.shortcuts.value).toEqual(DEFAULT_SHORTCUTS);
    expect(persisted.shortcuts.togglePlayback.shortcut).toBe("");
    bindings.shortcuts.value.toggleWindow.global = true;
    expect(DEFAULT_SHORTCUTS.toggleWindow.global).toBe(false);
    await bindings.save();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.shortcuts.togglePlayback.shortcut).toBe("Space");
  });

  it("clears with Escape in the draft without changing scope and persists only on save", async () => {
    const persisted = { ...defaults, shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS) };
    persisted.shortcuts.previous.global = true;
    const saved: Settings[] = [];
    const { bindings, element } = createDialog(async (command, args) => {
      if (command === "get_settings") return persisted;
      if (command === "save_settings") saved.push((args as { settings: Settings }).settings);
    });
    const escape = {
      key: "Escape",
      code: "Escape",
      isComposing: false,
      preventDefault() {},
      stopPropagation() {},
    } as KeyboardEvent;
    await bindings.show();
    bindings.recordShortcut(escape);
    expect(bindings.shortcuts.value.previous).toEqual({ shortcut: "", global: true });
    expect(element.open).toBe(true);
    expect(saved).toEqual([]);
    expect(persisted.shortcuts.previous.shortcut).toBe(DEFAULT_SHORTCUTS.previous.shortcut);
    bindings.close();
    await bindings.show();
    expect(bindings.shortcuts.value.previous.shortcut).toBe(DEFAULT_SHORTCUTS.previous.shortcut);
    bindings.recordShortcut(escape);
    await bindings.save();
    expect(saved[0]?.shortcuts.previous).toEqual({ shortcut: "", global: true });
  });

  it("preserves radio selection when close options are reordered during template updates", async () => {
    const general = source.match(
      /<fieldset\s+v-else-if="selectedCategory === 'general'"[\s\S]*?<\/fieldset>/,
    )?.[0];
    if (!general) throw new Error("Missing general settings");
    const labels = [...general.matchAll(/<label\b[\s\S]*?<\/label>/g)].map((match) => match[0]);
    const tray = labels.find((label) => label.includes('value="tray"'))!;
    const exit = labels.find((label) => label.includes('value="exit"'))!;
    const lightweight = labels.find((label) => label.includes('name="lightweight-on-close"'))!;
    const template = `<fieldset>${[tray, lightweight, exit].join("\n")}</fieldset>`;
    const previous = `<fieldset>${[tray, exit, lightweight].join("\n")}</fieldset>`.replace(
      /\skey="[^"]*"/g,
      "",
    );
    const before = Vue.compile(previous, { prefixIdentifiers: true });
    const after = Vue.compile(template, { prefixIdentifiers: true });
    const reordered = Vue.ref(false);
    const closeBehavior = Vue.ref("tray");
    const component = Vue.defineComponent({
      setup: () => ({
        closeBehavior,
        lightweightOnClose: Vue.ref(true),
        t: (text: string) => text,
      }),
      render() {
        const vnode = Reflect.apply(reordered.value ? after : before, this, [this, []]);
        // Template hot updates use a full diff rather than the previous template's block layout.
        if (Vue.isVNode(vnode)) Reflect.set(vnode, "dynamicChildren", null);
        return vnode;
      },
    });
    const renderer = createHostRenderer<HostNode>(
      (type, text = "") => {
        const node = Object.assign(createHostNode(type, text), {
          tagName: type.toUpperCase(),
          checked: false,
          value: "",
          addEventListener(event: string, handler: (event: unknown) => void) {
            node.props[`native-${event}`] = handler;
          },
        });
        return node;
      },
      {
        patchProp(node, key, _previous, next) {
          node.props[key] = next;
          if (key === "value") Object.assign(node, { value: next, _value: next });
        },
      },
    );
    const root = createHostNode("root");
    const app = renderer.createApp(component);
    app.mount(root);
    try {
      reordered.value = true;
      await Vue.nextTick();
      for (const value of ["exit", "tray", "exit"] as const) {
        const radio = findNode(root, (node) => node.props.value === value);
        const change = radio?.props["native-change"];
        if (!radio || typeof change !== "function") throw new Error("Missing radio change event");
        Reflect.set(radio, "checked", true);
        change({ target: radio });
        await Vue.nextTick();
        expect(closeBehavior.value).toBe(value);
        expect(Reflect.get(radio, "checked")).toBe(true);
      }
    } finally {
      app.unmount();
    }
  });

  it("blocks settings saving and closing while backup is pending", async () => {
    const calls: string[] = [];
    const { bindings, element } = createDialog(async (command) => {
      calls.push(command);
      return defaults;
    });
    await bindings.show();
    bindings.selectedCategory.value = "advanced";
    bindings.isBackingUp.value = true;
    bindings.close();
    await bindings.save();
    expect(element.open).toBe(true);
    expect(calls).toEqual(["get_settings"]);
    bindings.isBackingUp.value = false;
    bindings.close();
    expect(element.open).toBe(false);
  });

  it("suspends before loading, restores on close and does not share shortcut references", async () => {
    const { bindings, suspensions } = createDialog(async () => {
      expect(suspensions[suspensions.length - 1]).toBe(true);
      return defaults;
    });
    await bindings.show();
    expect(suspensions).toEqual([true]);
    bindings.shortcuts.value.previous.shortcut = "Ctrl+KeyP";
    expect(defaults.shortcuts.previous.shortcut).toBe("Ctrl+Shift+ArrowLeft");
    expect(DEFAULT_SHORTCUTS.previous.shortcut).toBe("Ctrl+Shift+ArrowLeft");
    bindings.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(suspensions).toEqual([true, false]);
    await bindings.show();
    expect(bindings.shortcuts.value).toEqual(defaults.shortcuts);
  });

  it("blocks loading when suspension fails and restores shortcuts", async () => {
    let loads = 0;
    const { bindings, suspensions, feedback } = createDialog(
      async () => {
        loads++;
        return defaults;
      },
      async (suspended) => {
        if (suspended) throw new Error("Unavailable");
      },
    );
    await bindings.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads).toBe(0);
    expect(bindings.isLoaded.value).toBe(false);
    expect(suspensions).toEqual([true, false]);
    expect(feedback[feedback.length - 1]?.key).toBe("settings-load");
  });

  it("restores after load failure but keeps suspension after save failure", async () => {
    let failLoad = true;
    const { bindings, element, suspensions } = createDialog(async (command) => {
      if (command === "get_settings" && !failLoad) return defaults;
      throw new Error("Unavailable");
    });
    await bindings.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(suspensions).toEqual([true, false]);
    bindings.close();
    failLoad = false;
    await bindings.show();
    await bindings.save();
    expect(suspensions[suspensions.length - 1]).toBe(true);
    expect(element.open).toBe(true);
  });

  for (const savedLocale of ["zh-CN", "en"] as const) {
    it(`persists locale ${savedLocale} and applies it only after successful saving`, async () => {
      const initialLocale = savedLocale === "en" ? "zh-CN" : "en";
      setLocale(initialLocale);
      let fail = true;
      const saved: unknown[] = [];
      const { bindings, element } = createDialog(async (command, args) => {
        if (command === "get_settings") return { ...defaults, locale: initialLocale };
        if (fail) throw new Error("Disk unavailable");
        saved.push(args);
      });
      await bindings.show();
      expect(bindings.selectedLocale.value).toBe(initialLocale);
      bindings.selectedLocale.value = savedLocale;
      expect(locale.value).toBe(initialLocale);
      await bindings.save();
      expect(locale.value).toBe(initialLocale);
      expect(element.open).toBe(true);
      fail = false;
      await bindings.save();
      expect(saved).toEqual([{ settings: { ...defaults, locale: savedLocale } }]);
      expect(locale.value).toBe(savedLocale);
      expect(element.open).toBe(false);
    });
  }

  it("cancel does not apply a language change and reopening restores the saved language", async () => {
    const { bindings } = createDialog(async () => defaults);
    await bindings.show();
    bindings.selectedLocale.value = "en";
    bindings.close();
    expect(locale.value).toBe("zh-CN");
    await bindings.show();
    expect<Settings["locale"]>(bindings.selectedLocale.value).toBe("zh-CN");
  });

  it("opens only the app log directory and switches detail immediately without persisting it", async () => {
    const calls: Array<[string, unknown]> = [];
    const { bindings } = createDialog(async (command, args) => {
      calls.push([command, args]);
      return defaults;
    });
    await bindings.show();
    await bindings.openLogs();
    bindings.detailedLogging.value = true;
    await bindings.changeLogging();
    expect(calls).toEqual([
      ["get_settings", undefined],
      ["open_logs_directory", undefined],
      ["set_detailed_logging", { enabled: true }],
    ]);
    await bindings.save();
    expect(calls[calls.length - 1]).toEqual(["save_settings", { settings: defaults }]);
    expect(JSON.stringify(calls[calls.length - 1])).not.toContain("detailedLogging");
    expect(createDialog(async () => defaults).bindings.detailedLogging.value).toBe(false);
  });

  it("notifies diagnostic failures, rolls back the toggle and permits another operation", async () => {
    let fail = true;
    const { bindings, feedback } = createDialog(async (command) => {
      if (command === "get_settings") return defaults;
      if (fail) throw new Error("permission denied");
    });
    await bindings.show();
    await bindings.openLogs();
    expect(feedback[feedback.length - 1]).toMatchObject({
      type: "error",
      message: "打开日志目录失败，请查看日志",
    });
    bindings.detailedLogging.value = true;
    await bindings.changeLogging();
    expect(bindings.detailedLogging.value).toBe(false);
    expect(feedback[feedback.length - 1]).toMatchObject({
      type: "error",
      message: "切换日志级别失败，请查看日志",
    });
    expect(bindings.isChangingLogging.value).toBe(false);
    fail = false;
    bindings.detailedLogging.value = true;
    await bindings.changeLogging();
    expect(bindings.detailedLogging.value).toBe(true);
  });

  it("renders categories and records, clears and persists shortcuts without help text", async () => {
    const saved: Settings[] = [];
    const suspensions: boolean[] = [];
    const feedback: NotificationInput[] = [];
    let failSave = false;
    const events: string[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { dispatchEvent: (event: Event) => events.push(event.type) },
    });
    let persisted = { ...defaults, shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS) };
    const modules: Record<string, unknown> = {
      vue: Vue,
      "@lucide/vue": icons,
      "@/shared/notifications/center": {
        notify: (input: NotificationInput) => feedback.push(input),
      },
      "@/features/settings/about/AboutPanel.vue": Vue.defineComponent({
        setup: () => () => Vue.h("div", { "data-about": "" }, "NewBee"),
      }),
      "@/features/backup/components/BackupOptions.vue": Vue.defineComponent({
        setup: () => () => Vue.h("button", { type: "button" }, "导出备份"),
      }),
      "@/features/library/monitoring/MonitoringOptions.vue": Vue.defineComponent({
        setup:
          (_, { slots }) =>
          () =>
            Vue.h("div", slots.heading?.()),
      }),
      "@tauri-apps/api/core": {
        invoke: async (command: string, args?: { settings: Settings; suspended: boolean }) => {
          if (command === "set_shortcuts_suspended" && args) suspensions.push(args.suspended);
          if (command === "get_settings") return persisted;
          if (command === "save_settings" && args) {
            if (failSave) throw "Shortcut already registered";
            saved.push(args.settings);
            persisted = args.settings;
          }
        },
        isTauri: () => true,
      },
      "@/features/settings/events": { SETTINGS_CHANGED_EVENT },
      "@/features/settings/accent": AccentColor,
      "@/features/settings/appearance": { applyAppearance: () => {} },
    };
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(source, filename),
      modules,
    ).default;
    const renderer = createHostRenderer<HostNode>(
      (type, text = "") => {
        const node = Object.assign(createHostNode(type, text), {
          open: false,
          value: "",
          checked: false,
          selected: false,
          tagName: type.toUpperCase(),
          addEventListener: (event: string, handler: (event: unknown) => void) => {
            node.props[`native-${event}`] = handler;
          },
          removeEventListener: () => {},
          getRootNode: () => ({ activeElement: null }),
          focus() {},
          showModal() {
            this.open = true;
          },
          close() {
            this.open = false;
          },
        });
        Object.defineProperty(node, "options", {
          get: () => node.children.filter((child) => child.type === "option"),
        });
        return node;
      },
      {
        patchProp(node, key, _previous, next) {
          node.props[key] = next;
          if (key === "value") Object.assign(node, { value: next, _value: next });
        },
      },
    );
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "Document");
    const originalShadowRoot = Object.getOwnPropertyDescriptor(globalThis, "ShadowRoot");
    Object.defineProperty(globalThis, "Document", { configurable: true, value: class Document {} });
    Object.defineProperty(globalThis, "ShadowRoot", {
      configurable: true,
      value: class ShadowRoot {},
    });
    const root = createHostNode("root");
    const app = renderer.createApp(component);
    const dialog = app.mount(root) as unknown as { show: () => Promise<void> };
    try {
      await dialog.show();
      await Vue.nextTick();
      expect(String(findNode(root, (node) => node.type === "dialog")?.props.class)).toContain(
        "sidebar-scrollbars",
      );
      const header = findNode(root, (node) => node.type === "header");
      const footer = findNode(root, (node) => node.type === "footer");
      if (!header || !footer) throw new Error("Missing dialog header or footer");
      expect(getTextContent(header).trim()).toBe("设置");
      expect(findNode(header, (node) => node.type === "button")).toBeNull();
      expect(getTextContent(footer)).toContain("取消");
      expect(getTextContent(footer)).toContain("保存");

      const panel = findNode(root, (node) => node.props.id === "settings-category-panel");
      const navigation = findNode(root, (node) => node.props["aria-label"] === "设置分类");
      if (!panel || !navigation) throw new Error("Missing settings panel or navigation");
      const categoryButtons = navigation.children.filter((node) => node.type === "button");
      expect(categoryButtons.map((button) => getTextContent(button).trim())).toEqual([
        "常规",
        "外观",
        "播放",
        "媒体库",
        "歌词",
        "快捷键",
        "高级",
        "关于",
      ]);
      for (const button of categoryButtons) {
        if (typeof button.props.onClick !== "function") throw new Error("Missing category handler");
        button.props.onClick();
        await Vue.nextTick();
        const heading = findNode(panel, (node) => node.type === "h3");
        const category = getTextContent(button).trim();
        if (category === "快捷键") {
          expect(heading).not.toBeNull();
          expect(getTextContent(heading!)).toBe(category);
        } else {
          expect(heading).toBeNull();
        }
        expect(
          findNode(panel, (node) => String(node.props["aria-label"] ?? "").endsWith("设置说明")),
        ).toBeNull();
        expect(panel.props["aria-labelledby"]).toBe(button.props.id);
        if (category === "媒体库") {
          const content = getTextContent(panel);
          const labels = ["监视文件夹", "扫描时补齐 ReplayGain 标签", "专辑排序", "显示播放统计"];
          for (const label of labels) expect(content).toContain(label);
          const positions = labels.map((label) => content.indexOf(label));
          expect(positions).toEqual([...positions].sort((left, right) => left - right));
          expect(findNode(panel, (node) => node.props.name === "replay-gain")).toBeNull();
          expect(findNode(panel, (node) => node.props.name === "replay-gain-preamp")).toBeNull();
        }
        if (category === "播放") {
          expect(getTextContent(panel)).not.toContain("监视文件夹");
          expect(getTextContent(panel)).not.toContain("专辑排序");
          expect(findNode(panel, (node) => node.props.name === "scan-replay-gain")).toBeNull();
          setLocale("en");
          await Vue.nextTick();
          expect(getTextContent(button).trim()).toBe("Playback");
          setLocale("zh-CN");
          await Vue.nextTick();
          const preamp = findNode(panel, (node) => node.props.name === "replay-gain-preamp");
          const toggle = findNode(panel, (node) => node.props.name === "replay-gain");
          const reset = findNode(panel, (node) => node.props["aria-label"] === "恢复默认");
          if (!preamp || !toggle || !reset) throw new Error("Missing ReplayGain controls");
          expect(preamp.props.type).toBe("number");
          expect(preamp.props.min).toBe("-20");
          expect(preamp.props.max).toBe("20");
          expect(preamp.props.step).toBe("0.5");
          expect(preamp.props.disabled).toBe(false);
          const change = toggle.props["native-change"];
          const input = preamp.props["native-input"];
          const restore = reset.props.onClick;
          if (
            typeof change !== "function" ||
            typeof input !== "function" ||
            typeof restore !== "function"
          )
            throw new Error("Missing ReplayGain handlers");
          Reflect.set(preamp, "value", "3.5");
          input({ target: preamp });
          await Vue.nextTick();
          expect(Number(Reflect.get(preamp, "value"))).toBe(3.5);
          Reflect.set(toggle, "checked", false);
          change({ target: toggle });
          await Vue.nextTick();
          expect(preamp.props.disabled).toBe(true);
          expect(reset.props.disabled).toBe(true);
          expect(Number(Reflect.get(preamp, "value"))).toBe(3.5);
          Reflect.set(toggle, "checked", true);
          change({ target: toggle });
          await Vue.nextTick();
          expect(preamp.props.disabled).toBe(false);
          restore();
          await Vue.nextTick();
          expect(Reflect.get(preamp, "value")).toBe(0);
        }
        if (category === "关于") {
          expect(findNode(panel, (node) => node.props["data-about"] === "")).not.toBeNull();
          expect(getTextContent(footer)).not.toContain("保存");
        }
        if (category === "高级") {
          expect(getTextContent(panel)).toContain("诊断");
          expect(getTextContent(panel)).toContain("打开日志目录");
          expect(getTextContent(panel)).toContain("备份");
          expect(getTextContent(panel)).toContain("导出备份");
          expect(getTextContent(footer)).toContain("保存");
          setLocale("en");
          await Vue.nextTick();
          expect(getTextContent(button).trim()).toBe("Advanced");
          setLocale("zh-CN");
          await Vue.nextTick();
        }
      }
      const generalButton = categoryButtons[0]!;
      if (typeof generalButton.props.onClick !== "function")
        throw new Error("Missing general handler");
      generalButton.props.onClick();
      await Vue.nextTick();
      const lightweightOption = findNode(
        panel,
        (node) => node.props.name === "lightweight-on-close",
      );
      expect(lightweightOption?.props.disabled).toBe(false);
      const closeOptions = ["exit", "tray", "exit", "tray"] as const;
      for (const value of closeOptions) {
        const radio = findNode(
          panel,
          (node) => node.props.name === "close-behavior" && node.props.value === value,
        );
        const change = radio?.props["native-change"];
        if (!radio || typeof change !== "function") throw new Error("Missing close behavior event");
        Reflect.set(radio, "checked", true);
        change({ target: radio });
        await Vue.nextTick();
        expect(lightweightOption?.props.disabled).toBe(value !== "tray");
        for (const option of closeOptions) {
          const input = findNode(
            panel,
            (node) => node.props.name === "close-behavior" && node.props.value === option,
          );
          expect(Reflect.get(input!, "checked")).toBe(option === value);
        }
      }
      const languageSelect = findNode(panel, (node) => node.props.name === "locale");
      expect(languageSelect?.type).toBe("select");
      expect(languageSelect?.children.map((node) => getTextContent(node))).toEqual([
        "简体中文",
        "English",
      ]);
      setLocale("en");
      await Vue.nextTick();
      expect(getTextContent(header).trim()).toBe("Settings");
      expect(getTextContent(footer)).toContain("Cancel");
      expect(getTextContent(footer)).toContain("Save");
      expect(getTextContent(navigation)).toContain("General");
      expect(getTextContent(navigation)).toContain("Appearance");
      expect(getTextContent(panel)).toContain("Language");
      setLocale("zh-CN");
      await Vue.nextTick();
      for (const [category, included, excluded] of [
        ["常规", "关闭窗口时", "主题色"],
        ["外观", "主题色", "专辑排序"],
        ["媒体库", "专辑排序", "关闭窗口时"],
        ["歌词", "网易云音乐", "关闭窗口时"],
      ] as const) {
        const button = findNode(
          navigation,
          (node) => node.type === "button" && getTextContent(node).trim() === category,
        );
        if (!button) throw new Error("Missing category button");
        const click = button.props.onClick;
        if (typeof click !== "function") throw new Error("Category button has no click handler.");
        click();
        await Vue.nextTick();
        expect(button.props["aria-current"]).toBe("true");
        expect(getTextContent(panel)).toContain(included);
        expect(getTextContent(panel)).not.toContain(excluded);
        const explanation = {
          常规: "托盘菜单中的",
          外观: "保存后立即生效",
          媒体库: "缺少日期的专辑",
          歌词: "不检查是否缺少",
        }[category];
        expect(getTextContent(panel)).not.toContain(explanation);
        const help = findNode(panel, (node) => node.props["aria-label"] === `${category}设置说明`);
        expect(help).toBeNull();
        if (category === "外观") {
          const themeSelect = findNode(panel, (node) => node.props.name === "theme-mode");
          expect(themeSelect?.type).toBe("select");
          expect(themeSelect?.children.map((node) => node.props.value)).toEqual([
            "system",
            "light",
            "dark",
          ]);
          const layoutSelect = findNode(panel, (node) => node.props.name === "layout-density");
          expect(layoutSelect?.type).toBe("select");
          expect(layoutSelect?.children.map((node) => node.props.value)).toEqual([
            "regular",
            "compact",
          ]);
          for (const color of AccentColor.ACCENT_COLORS) {
            const preset = findNode(
              panel,
              (node) => node.props["aria-label"] === `${color.label}色`,
            );
            if (!preset || typeof preset.props.onClick !== "function")
              throw new Error("Missing accent color preset");
            expect(preset.type).toBe("button");
            expect(preset.props.type).toBe("button");
            expect(preset.props["aria-pressed"]).toBe(
              color.value === AccentColor.DEFAULT_ACCENT_COLOR,
            );
          }
          setLocale("en");
          await Vue.nextTick();
          expect(getTextContent(panel)).toContain("Accent color");
          for (const label of ["Green", "Blue", "Purple", "Pink", "Orange"]) {
            expect(findNode(panel, (node) => node.props["aria-label"] === label)?.type).toBe(
              "button",
            );
          }
          setLocale("zh-CN");
          await Vue.nextTick();
          const bluePreset = findNode(panel, (node) => node.props["aria-label"] === "蓝色");
          if (!bluePreset || typeof bluePreset.props.onClick !== "function")
            throw new Error("Missing blue preset");
          bluePreset.props.onClick();
          await Vue.nextTick();
          expect(bluePreset.props["aria-pressed"]).toBe(true);
          expect(
            findNode(panel, (node) => node.props["aria-label"] === "绿色")?.props["aria-pressed"],
          ).toBe(false);
          const picker = findNode(panel, (node) => node.props.name === "accent-color-picker");
          const textInput = findNode(panel, (node) => node.props.name === "accent-color");
          expect(picker?.type).toBe("input");
          expect(picker?.props.type).toBe("color");
          expect(picker?.props["aria-label"]).toBe("选择自定义主题色");
          expect(textInput?.type).toBe("input");
          expect(textInput?.props.type).toBe("text");
          expect(textInput?.props["aria-label"]).toBe("自定义主题色");
          expect(textInput?.props.pattern).toBe("#[0-9a-fA-F]{6}");
          expect(textInput?.props.maxlength).toBe("7");
          expect(textInput?.props.required).toBe("");
          if (!picker || !textInput) throw new Error("Missing custom accent color inputs");
          expect(Reflect.get(picker, "value")).toBe("#60a5fa");
          expect(Reflect.get(textInput, "value")).toBe("#60a5fa");
          for (const [input, color] of [
            [picker, "#123456"],
            [textInput, "#ABCDEF"],
          ] as const) {
            const update = input.props["onUpdate:modelValue"];
            if (typeof update !== "function") throw new Error("Missing accent color input binding");
            update(color);
            await Vue.nextTick();
            expect(Reflect.get(picker, "value")).toBe(color);
            expect(Reflect.get(textInput, "value")).toBe(color);
            expect(bluePreset.props["aria-pressed"]).toBe(false);
          }
          expect(getTextContent(panel)).toContain("减少动态效果");
          expect(findNode(panel, (node) => node.props.name === "reduced-motion")?.props.type).toBe(
            "checkbox",
          );
          expect(getTextContent(panel)).toContain("专辑详情封面背景");
          expect(getTextContent(panel)).toContain("播放页封面背景");
          expect(
            findNode(panel, (node) => node.props.name === "playing-cover-background")?.props.type,
          ).toBe("checkbox");
          expect(
            findNode(panel, (node) => node.props.name === "album-cover-background")?.props.type,
          ).toBe("checkbox");
        }
        if (category === "歌词") {
          expect(getTextContent(panel)).toContain("网易云歌词内容");
          const neteaseModeSelect = findNode(
            panel,
            (node) => node.props.name === "netease-lyrics-mode",
          );
          expect(neteaseModeSelect?.type).toBe("select");
          expect(neteaseModeSelect?.children.map((node) => node.props.value)).toEqual([
            "original",
            "translated",
            "bilingual",
          ]);
        }
      }
      const shortcutsButton = findNode(
        navigation,
        (node) => node.type === "button" && getTextContent(node).trim() === "快捷键",
      );
      if (!shortcutsButton || typeof shortcutsButton.props.onClick !== "function")
        throw new Error("Missing shortcuts category");
      shortcutsButton.props.onClick();
      await Vue.nextTick();
      expect(findNode(panel, (node) => node.props["aria-label"] === "快捷键设置说明")).toBeNull();
      expect(getTextContent(panel)).not.toContain("缺少日期");
      const initialRecorder = findNode(panel, (node) => node.props.name === "shortcut-previous");
      expect(
        findNode(panel, (node) => node.type === "button" && getTextContent(node).trim() === "清除"),
      ).toBeNull();
      const reset = findNode(
        panel,
        (node) => node.type === "button" && node.props["aria-label"] === "恢复默认",
      );
      if (
        !initialRecorder ||
        typeof initialRecorder.props.onKeydown !== "function" ||
        typeof reset?.props.onClick !== "function"
      )
        throw new Error("Missing shortcut draft controls");
      initialRecorder.props.onKeydown({
        key: "Escape",
        code: "Escape",
        isComposing: false,
        preventDefault() {},
        stopPropagation() {},
      });
      await Vue.nextTick();
      expect(Reflect.get(initialRecorder, "value")).toBe("");
      await reset.props.onClick();
      await Vue.nextTick();
      expect(Reflect.get(initialRecorder, "value")).toBe(
        formatShortcut(DEFAULT_SHORTCUTS.previous.shortcut),
      );
      expect(getTextContent(panel)).not.toContain("确认恢复");
      expect(saved).toEqual([]);
      for (const label of [
        "上一首",
        "下一首",
        "播放/暂停",
        "窗口切换",
        "正在播放",
        "音乐库",
        "播放列表",
        "Inbox",
      ])
        expect(getTextContent(panel)).toContain(label);
      const table = findNode(panel, (node) => node.type === "table");
      if (!table) throw new Error("Missing shortcut table");
      const scroller = table.parent;
      if (!scroller) throw new Error("Missing shortcut table scroller");
      expect(String(scroller.props.class)).toContain("overflow-auto");
      expect(String(scroller.props.class)).toContain("min-h-0");
      expect(String(panel.props.class)).toContain("overflow-hidden");
      expect(String(table.props.class)).toContain("table-fixed");
      expect(findNode(scroller, (node) => node === initialRecorder)).toBe(initialRecorder);
      expect(findNode(panel, (node) => node.props.name === "shortcut-recorder")).toBeNull();
      const shortcutHeading = findNode(panel, (node) => node.type === "h3");
      expect(shortcutHeading).not.toBeNull();
      expect(getTextContent(shortcutHeading!)).toBe("快捷键");
      expect(reset.parent).toBe(shortcutHeading?.parent ?? null);
      expect(getTextContent(reset)).toBe("");
      expect(
        table.children
          .filter((node) => node.type === "tbody")
          .map((node) => node.props["data-shortcut-group"]),
      ).toEqual(BINDING_GROUPS.map((group) => group.id));
      for (const group of BINDING_GROUPS) {
        const body = findNode(table, (node) => node.props["data-shortcut-group"] === group.id);
        if (!body) throw new Error(`Missing shortcut group: ${group.id}`);
        const heading = findNode(body, (node) => node.props.scope === "rowgroup");
        expect(getTextContent(heading!)).toBe(group.label);
        expect(
          body.children
            .filter((node) => node.props["data-shortcut-action"])
            .map((node) => node.props["data-shortcut-action"]),
        ).toEqual([...group.actions]);
      }
      const rows = SHORTCUT_ACTIONS.map((action) => {
        const row = findNode(table, (node) => node.props["data-shortcut-action"] === action);
        if (!row) throw new Error("Missing shortcut action row");
        return row;
      });
      expect(rows).toHaveLength(SHORTCUT_ACTIONS.length);
      for (const row of rows) expect(findNode(row, (node) => node.type === "button")).toBeNull();
      const headings = findNode(table, (node) => node.type === "thead");
      expect(headings?.children[0]?.children.map((node) => getTextContent(node))).toEqual([
        "操作",
        "快捷键",
        "全局",
        "恢复默认",
      ]);
      const recorders: HostNode[] = [];
      const collectRecorders = (node: HostNode) => {
        if (node.props["data-shortcut-recorder"] === "") recorders.push(node);
        node.children.forEach(collectRecorders);
      };
      collectRecorders(panel);
      expect(recorders).toHaveLength(SHORTCUT_ACTIONS.length);
      const selectAction = async (action: ShortcutAction) => {
        const row = rows[SHORTCUT_ACTIONS.indexOf(action)]!;
        const recorder = findNode(row, (node) => node.props["data-shortcut-recorder"] === "");
        if (!recorder || typeof recorder.props.onClick !== "function")
          throw new Error("Missing inline shortcut recorder");
        recorder.props.onClick();
        await Vue.nextTick();
        expect(String(row.props.class)).toContain("bg-app-accent/15");
      };
      for (const action of SHORTCUT_ACTIONS) {
        await selectAction(action);
        const global = findNode(panel, (node) => node.props.name === `shortcuts-global-${action}`);
        expect(Boolean(global)).toBe(allowsGlobalShortcut(action));
        if (global) expect(global.props.type).toBe("checkbox");
        const recorder = findNode(panel, (node) => node.props.name === `shortcut-${action}`);
        if (!recorder || typeof recorder.props.onKeydown !== "function")
          throw new Error("Missing shortcut recorder");
        expect(recorder.props.readonly).toBe("");
        expect(recorder.props["data-shortcut-recorder"]).toBe("");
        expect(recorder.props.placeholder).toBeUndefined();
        expect(Reflect.get(recorder, "value")).toBe(
          formatShortcut(DEFAULT_SHORTCUTS[action].shortcut),
        );
        let prevented = false;
        let stopped = false;
        const press = (key: string, code: string, ctrlKey = false, isComposing = false) =>
          recorder.props.onKeydown instanceof Function &&
          recorder.props.onKeydown({
            key,
            code,
            ctrlKey,
            altKey: false,
            shiftKey: false,
            metaKey: false,
            isComposing,
            preventDefault: () => {
              prevented = true;
            },
            stopPropagation: () => {
              stopped = true;
            },
          });
        press("Control", "ControlLeft", true);
        press("a", "KeyA", true, true);
        await Vue.nextTick();
        expect(Reflect.get(recorder, "value")).toBe(
          formatShortcut(DEFAULT_SHORTCUTS[action].shortcut),
        );
        press("a", "KeyA", true);
        await Vue.nextTick();
        expect(prevented).toBe(true);
        expect(stopped).toBe(true);
        expect(Reflect.get(recorder, "value")).toBe("Ctrl + A");
        const originalInput = Object.getOwnPropertyDescriptor(globalThis, "HTMLInputElement");
        let blurred = false;
        class Input {
          blur() {
            blurred = true;
          }
        }
        Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: Input });
        prevented = false;
        stopped = false;
        try {
          recorder.props.onKeydown({
            key: "Escape",
            code: "Escape",
            isComposing: false,
            target: new Input(),
            preventDefault() {
              prevented = true;
            },
            stopPropagation() {
              stopped = true;
            },
          });
        } finally {
          if (originalInput) Object.defineProperty(globalThis, "HTMLInputElement", originalInput);
          else Reflect.deleteProperty(globalThis, "HTMLInputElement");
        }
        await Vue.nextTick();
        expect(blurred).toBe(false);
        expect(prevented).toBe(true);
        expect(stopped).toBe(true);
        expect(Reflect.get(recorder, "value")).toBe("");
        expect(
          Reflect.get(
            findNode(root, (node) => node.type === "dialog")!,
            "open",
          ),
        ).toBe(true);
        press("a", "KeyA", true);
        press("Delete", "Delete");
        await Vue.nextTick();
        expect(Reflect.get(recorder, "value")).toBe("");
        press("a", "KeyA", true);
        await Vue.nextTick();
        const row = recorder.parent?.parent;
        if (!row) throw new Error("Missing shortcut row");
        const undo = findNode(row, (node) => node.type === "button");
        expect(undo?.props["aria-label"]).toBe(`恢复默认 ${getTextContent(row.children[0]!)}`);
        expect(getTextContent(undo!)).toBe("");
        press("Escape", "Escape");
        await Vue.nextTick();
        expect(Reflect.get(recorder, "value")).toBe("");
        press("a", "KeyA", true);
        press("Backspace", "Backspace");
        await Vue.nextTick();
        expect(Reflect.get(recorder, "value")).toBe("");
        if (global && typeof global.props["onUpdate:modelValue"] === "function")
          global.props["onUpdate:modelValue"](true);
        if (!undo || typeof undo.props.onClick !== "function")
          throw new Error("Missing action reset");
        undo.props.onClick();
        await Vue.nextTick();
        expect(Reflect.get(recorder, "value")).toBe(
          formatShortcut(DEFAULT_SHORTCUTS[action].shortcut),
        );
        if (global) expect(Reflect.get(global, "checked")).toBe(DEFAULT_SHORTCUTS[action].global);
        expect(findNode(row, (node) => node.type === "button")).toBeNull();
        if (global && typeof global.props["onUpdate:modelValue"] === "function") {
          global.props["onUpdate:modelValue"](!DEFAULT_SHORTCUTS[action].global);
          await Vue.nextTick();
          expect(findNode(row, (node) => node.type === "button")).not.toBeNull();
          global.props["onUpdate:modelValue"](DEFAULT_SHORTCUTS[action].global);
          await Vue.nextTick();
          expect(findNode(row, (node) => node.type === "button")).toBeNull();
        }
        expect(saved).toEqual([]);
        press("Backspace", "Backspace");
        await Vue.nextTick();
      }
      await selectAction("previous");
      const previous = findNode(panel, (node) => node.props.name === "shortcut-previous");
      const next = findNode(panel, (node) => node.props.name === "shortcut-next");
      const global = findNode(panel, (node) => node.props.name === "shortcuts-global-previous");
      const form = findNode(root, (node) => node.type === "form");
      if (
        !previous ||
        !next ||
        typeof next.props.onKeydown !== "function" ||
        typeof previous.props.onKeydown !== "function" ||
        !global ||
        typeof global.props["onUpdate:modelValue"] !== "function" ||
        !form ||
        typeof form.props.onSubmit !== "function"
      )
        throw new Error("Missing shortcut controls");
      previous.props.onKeydown({
        key: "p",
        code: "KeyP",
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault() {},
        stopPropagation() {},
      });
      global.props["onUpdate:modelValue"](true);
      await Vue.nextTick();
      expect(Reflect.get(global, "checked")).toBe(true);
      expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
      await selectAction("next");
      expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
      expect(Reflect.get(global, "checked")).toBe(true);
      next.props.onKeydown({
        key: "n",
        code: "KeyN",
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault() {},
        stopPropagation() {},
      });
      await Vue.nextTick();
      expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
      expect(Reflect.get(next, "value")).toBe("Ctrl + N");
      await selectAction("previous");
      expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
      expect(Reflect.get(global, "checked")).toBe(true);
      previous.props.onKeydown({
        key: "Escape",
        code: "Escape",
        isComposing: false,
        preventDefault() {},
        stopPropagation() {},
      });
      await Vue.nextTick();
      expect(Reflect.get(previous, "value")).toBe("");
      expect(Reflect.get(global, "checked")).toBe(true);
      expect(Reflect.get(next, "value")).toBe("Ctrl + N");
      previous.props.onKeydown({
        key: "p",
        code: "KeyP",
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault() {},
        stopPropagation() {},
      });
      expect(persisted.shortcuts).toEqual(cloneShortcuts(DEFAULT_SHORTCUTS));
      failSave = true;
      await form.props.onSubmit({ preventDefault() {} });
      await Vue.nextTick();
      expect(saved).toEqual([]);
      expect(feedback[feedback.length - 1]?.message).toBe(
        "保存设置失败: Shortcut already registered",
      );
      expect(
        Reflect.get(
          findNode(root, (node) => node.type === "dialog")!,
          "open",
        ),
      ).toBe(true);
      expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
      expect(Reflect.get(global, "checked")).toBe(true);
      await selectAction("next");
      expect(Reflect.get(next, "value")).toBe("Ctrl + N");
      expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
      expect(Reflect.get(global, "checked")).toBe(true);
      failSave = false;
      await form.props.onSubmit({ preventDefault() {} });
      expect(saved[0]?.shortcuts).toEqual({
        ...cloneShortcuts({}),
        previous: { shortcut: "Ctrl+KeyP", global: true },
        next: { shortcut: "Ctrl+KeyN", global: false },
      });
      expect(events).toEqual([SETTINGS_CHANGED_EVENT]);
      expect(
        Reflect.get(
          findNode(root, (node) => node.type === "dialog")!,
          "open",
        ),
      ).toBe(false);
      await dialog.show();
      await Vue.nextTick();
      shortcutsButton.props.onClick();
      await Vue.nextTick();
      expect(
        Reflect.get(
          findNode(panel, (node) => node.props.name === "shortcut-previous")!,
          "value",
        ),
      ).toBe("Ctrl + P");
      const reopenedGlobal = findNode(
        panel,
        (node) => node.props.name === "shortcuts-global-previous",
      );
      expect(reopenedGlobal && Reflect.get(reopenedGlobal, "checked")).toBe(true);
      const reopenedNext = findNode(panel, (node) => node.props["data-shortcut-action"] === "next");
      const reopenedNextButton =
        reopenedNext && findNode(reopenedNext, (node) => node.props.name === "shortcut-next");
      if (!reopenedNextButton || typeof reopenedNextButton.props.onClick !== "function")
        throw new Error("Missing reopened next action");
      reopenedNextButton.props.onClick();
      await Vue.nextTick();
      expect(
        Reflect.get(
          findNode(panel, (node) => node.props.name === "shortcut-next")!,
          "value",
        ),
      ).toBe("Ctrl + N");
      expect(reopenedGlobal && Reflect.get(reopenedGlobal, "checked")).toBe(true);
      const nativeDialog = findNode(root, (node) => node.type === "dialog");
      if (
        !nativeDialog ||
        typeof nativeDialog.props.onCancel !== "function" ||
        typeof nativeDialog.props.onClose !== "function"
      )
        throw new Error("Missing close handlers");
      nativeDialog.props.onCancel({ preventDefault() {} });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(suspensions[suspensions.length - 1]).toBe(false);
      await dialog.show();
      nativeDialog.props.onClose();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(suspensions[suspensions.length - 1]).toBe(true);
      Reflect.set(nativeDialog, "open", false);
      nativeDialog.props.onClose();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(suspensions[suspensions.length - 1]).toBe(false);
    } finally {
      app.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(suspensions[suspensions.length - 1]).toBe(false);
      if (originalDocument) Object.defineProperty(globalThis, "Document", originalDocument);
      else Reflect.deleteProperty(globalThis, "Document");
      if (originalShadowRoot) Object.defineProperty(globalThis, "ShadowRoot", originalShadowRoot);
      else Reflect.deleteProperty(globalThis, "ShadowRoot");
    }
  });

  for (const themeMode of ["system", "light", "dark"] as const) {
    it(`persists and applies ${themeMode} theme only after saving`, async () => {
      const saved: unknown[] = [];
      const { bindings, appliedThemes } = createDialog(async (command, args) => {
        if (command === "get_settings") return { ...defaults, themeMode: "dark" };
        saved.push(args);
      });
      await bindings.show();
      expect(bindings.themeMode.value).toBe("dark");
      bindings.themeMode.value = themeMode;
      expect(appliedThemes).toEqual([]);
      await bindings.save();
      expect(saved).toEqual([{ settings: { ...defaults, themeMode } }]);
      expect(appliedThemes).toEqual([themeMode]);
    });
  }

  for (const option of AccentColor.ACCENT_COLORS) {
    it(`persists and applies ${option.value} only after saving`, async () => {
      const calls: unknown[] = [];
      const { bindings, appliedColors } = createDialog(async (command, args) => {
        if (command === "get_settings") return defaults;
        calls.push(args);
      });
      await bindings.show();
      bindings.accentColor.value = option.value;
      expect(appliedColors).toEqual([]);
      await bindings.save();
      expect(calls).toEqual([{ settings: { ...defaults, accentColor: option.value } }]);
      expect(appliedColors).toEqual([option.value]);
    });
  }

  it("normalizes a custom uppercase color before saving and applying it", async () => {
    const saved: unknown[] = [];
    const { bindings, element, events, appliedColors } = createDialog(async (command, args) => {
      if (command === "get_settings") return defaults;
      saved.push(args);
    });
    await bindings.show();
    bindings.accentColor.value = "#ABCDEF";
    expect(appliedColors).toEqual([]);
    await bindings.save();
    expect(saved).toEqual([{ settings: { ...defaults, accentColor: "#abcdef" } }]);
    expect(bindings.accentColor.value).toBe("#abcdef");
    expect(appliedColors).toEqual(["#abcdef"]);
    expect(events).toEqual([SETTINGS_CHANGED_EVENT]);
    expect(element.open).toBe(false);
  });

  for (const invalidColor of ["", "#abc", "#12345678", "#gggggg", "123456"]) {
    it(`blocks saving invalid accent color ${JSON.stringify(invalidColor)} without discarding edits`, async () => {
      const calls: string[] = [];
      const { bindings, element, events, appliedColors, feedback } = createDialog(
        async (command) => {
          calls.push(command);
          return defaults;
        },
      );
      await bindings.show();
      bindings.accentColor.value = invalidColor;
      bindings.closeBehavior.value = "exit";
      await bindings.save();
      expect(calls).toEqual(["get_settings"]);
      expect(element.open).toBe(true);
      expect(bindings.isLoaded.value).toBe(true);
      expect(bindings.accentColor.value).toBe(invalidColor);
      expect(bindings.closeBehavior.value).toBe("exit");
      expect(appliedColors).toEqual([]);
      expect(events).toEqual([]);
      expect(feedback).toEqual([
        { type: "error", message: "主题色必须是有效的 #RRGGBB 颜色", key: "settings-accent-color" },
      ]);
    });
  }

  it("loads and saves independent ReplayGain playback and opt-in scan preferences", async () => {
    let saved: Settings | undefined;
    const { bindings } = createDialog(async (command, args) => {
      if (command === "get_settings")
        return { ...defaults, replayGain: false, scanReplayGain: true };
      saved = (args as { settings: Settings }).settings;
    });
    await bindings.show();
    expect(bindings.replayGain.value).toBe(false);
    expect(bindings.scanReplayGain.value).toBe(true);
    bindings.replayGain.value = true;
    bindings.scanReplayGain.value = false;
    await bindings.save();
    expect(saved?.replayGain).toBe(true);
    expect(saved?.scanReplayGain).toBe(false);
  });

  it("defaults legacy preamp to zero and keeps changes as a draft until saving", async () => {
    const saved: Settings[] = [];
    let persisted: Partial<Settings> = { ...defaults, replayGainPreamp: -3.5 };
    const { bindings } = createDialog(async (command, args) => {
      if (command === "get_settings") return persisted;
      saved.push((args as { settings: Settings }).settings);
    });
    await bindings.show();
    expect(bindings.replayGainPreamp.value).toBe(-3.5);
    bindings.replayGainPreamp.value = 6;
    expect(saved).toEqual([]);
    bindings.close();
    await bindings.show();
    expect(bindings.replayGainPreamp.value).toBe(-3.5);
    bindings.replayGain.value = false;
    await bindings.save();
    expect(saved[0]).toMatchObject({ replayGain: false, replayGainPreamp: -3.5 });
    persisted = { ...defaults, replayGainPreamp: undefined };
    await bindings.show();
    expect(bindings.replayGainPreamp.value).toBe(0);
    bindings.replayGainPreamp.value = 20;
    await bindings.save();
    expect(saved[1]?.replayGainPreamp).toBe(20);
  });

  for (const value of [NaN, Infinity, -Infinity, -20.5, 20.5, 0.25, ""]) {
    it(`rejects invalid preamp ${String(value)} before saving`, async () => {
      let saves = 0;
      const { bindings, feedback, element } = createDialog(async (command) => {
        if (command === "get_settings") return defaults;
        saves++;
      });
      await bindings.show();
      Reflect.set(bindings.replayGainPreamp, "value", value);
      await bindings.save();
      expect(saves).toBe(0);
      expect(element.open).toBe(true);
      expect(feedback[feedback.length - 1]?.key).toBe("settings-replay-gain-preamp");
    });
  }

  it("loads and saves all settings and notifies the library after saving", async () => {
    const calls: Array<[string, unknown]> = [];
    const loaded: Settings = {
      replayGain: true,
      replayGainPreamp: 0,
      scanReplayGain: false,
      themeMode: "dark",
      lightweightOnClose: false,
      monitoringFolders: [],
      showPlaybackStatistics: false,
      layoutDensity: "regular",
      locale: "zh-CN",
      accentColor: "#60a5fa",
      reducedMotion: false,
      albumCoverBackground: true,
      playingCoverBackground: true,
      closeBehavior: "exit",
      albumSortBy: "year",
      albumSortOrder: "descending",
      lyricsProviders: ["netease"],
      neteaseLyricsMode: "translated",
      shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS),
    };
    const { bindings, element, events } = createDialog(async (command, args) => {
      calls.push([command, args]);
      return command === "get_settings" ? loaded : undefined;
    });
    await bindings.show();
    expect(bindings.closeBehavior.value).toBe("exit");
    expect(bindings.accentColor.value).toBe("#60a5fa");
    expect(bindings.themeMode.value).toBe("dark");
    bindings.themeMode.value = "system";
    expect(bindings.albumCoverBackground.value).toBe(true);
    expect(bindings.playingCoverBackground.value).toBe(true);
    expect(bindings.showPlaybackStatistics.value).toBe(false);
    bindings.showPlaybackStatistics.value = true;
    expect(bindings.albumSortBy.value).toBe("year");
    expect(bindings.albumSortOrder.value).toBe("descending");
    expect(bindings.neteaseLyricsMode.value).toBe("translated");
    expect(element.open).toBe(true);
    expect(events).toEqual([]);
    bindings.accentColor.value = AccentColor.DEFAULT_ACCENT_COLOR;
    bindings.albumCoverBackground.value = false;
    bindings.playingCoverBackground.value = false;
    bindings.closeBehavior.value = "tray";
    bindings.albumSortBy.value = "name";
    bindings.albumSortOrder.value = "ascending";
    bindings.neteaseLyricsMode.value = "bilingual";
    await bindings.save();
    expect(calls).toEqual([
      ["get_settings", undefined],
      ["save_settings", { settings: { ...defaults, neteaseLyricsMode: "bilingual" } }],
    ]);
    expect(events).toEqual([SETTINGS_CHANGED_EVENT]);
    expect(element.open).toBe(false);
  });

  it("cancel does not save or notify and reopening discards unsaved changes", async () => {
    const calls: string[] = [];
    const { bindings, events, appliedColors } = createDialog(async (command) => {
      calls.push(command);
      return defaults;
    });
    await bindings.show();
    bindings.closeBehavior.value = "exit";
    bindings.albumSortBy.value = "year";
    bindings.albumSortOrder.value = "descending";
    bindings.accentColor.value = "#a78bfa";
    bindings.albumCoverBackground.value = true;
    bindings.playingCoverBackground.value = true;
    bindings.neteaseLyricsMode.value = "translated";
    bindings.selectedCategory.value = "appearance";
    bindings.close();
    expect(appliedColors).toEqual([]);
    expect(calls).toEqual(["get_settings"]);
    expect(events).toEqual([]);
    await bindings.show();
    expect<DialogBindings["selectedCategory"]["value"]>(bindings.selectedCategory.value).toBe(
      "general",
    );
    expect<Settings["accentColor"]>(bindings.accentColor.value).toBe(
      AccentColor.DEFAULT_ACCENT_COLOR,
    );
    expect(bindings.albumCoverBackground.value).toBe(false);
    expect(bindings.playingCoverBackground.value).toBe(false);
    expect<Settings["neteaseLyricsMode"]>(bindings.neteaseLyricsMode.value).toBe("original");
    expect(appliedColors).toEqual([]);
    expect<Settings["closeBehavior"]>(bindings.closeBehavior.value).toBe("tray");
    expect<Settings["albumSortBy"]>(bindings.albumSortBy.value).toBe("name");
    expect<Settings["albumSortOrder"]>(bindings.albumSortOrder.value).toBe("ascending");
    expect(calls).toEqual(["get_settings", "get_settings"]);
    expect(events).toEqual([]);
  });

  it("preserves edits across categories and saves all categories together", async () => {
    const saved: unknown[] = [];
    const { bindings, appliedColors } = createDialog(async (command, args) => {
      if (command === "get_settings") return defaults;
      saved.push(args);
    });
    await bindings.show();
    expect(bindings.selectedCategory.value).toBe("general");
    bindings.closeBehavior.value = "exit";
    bindings.selectedCategory.value = "appearance";
    bindings.accentColor.value = "#60a5fa";
    bindings.albumCoverBackground.value = true;
    bindings.selectedCategory.value = "library";
    bindings.albumSortBy.value = "year";
    bindings.albumSortOrder.value = "descending";
    bindings.neteaseLyricsMode.value = "bilingual";
    bindings.selectedCategory.value = "general";
    expect(bindings.closeBehavior.value).toBe("exit");
    expect(bindings.accentColor.value).toBe("#60a5fa");
    expect(saved).toEqual([]);
    expect(appliedColors).toEqual([]);

    await bindings.save();

    expect(saved).toEqual([
      {
        settings: {
          themeMode: "system",
          locale: "zh-CN",
          layoutDensity: "regular",
          accentColor: "#60a5fa",
          reducedMotion: false,
          albumCoverBackground: true,
          playingCoverBackground: false,
          closeBehavior: "exit",
          lightweightOnClose: false,
          showPlaybackStatistics: true,
          replayGain: true,
          replayGainPreamp: 0,
          scanReplayGain: false,
          monitoringFolders: [],
          albumSortBy: "year",
          albumSortOrder: "descending",
          lyricsProviders: ["netease"],
          neteaseLyricsMode: "bilingual",
          shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS),
        },
      },
    ]);
  });

  for (const albumEnabled of [false, true]) {
    for (const playingEnabled of [false, true]) {
      it(`saves album background ${albumEnabled} and playing background ${playingEnabled} independently`, async () => {
        const saved: unknown[] = [];
        const loaded = {
          ...defaults,
          albumCoverBackground: albumEnabled,
          playingCoverBackground: playingEnabled,
        };
        const { bindings } = createDialog(async (command, args) => {
          if (command === "get_settings") return loaded;
          saved.push(args);
        });
        await bindings.show();
        expect(bindings.albumCoverBackground.value).toBe(albumEnabled);
        expect(bindings.playingCoverBackground.value).toBe(playingEnabled);
        await bindings.save();
        expect(saved).toEqual([{ settings: loaded }]);
      });
    }
  }

  for (const enabled of [false, true]) {
    it(`persists statistics visibility ${enabled}`, async () => {
      const saved: unknown[] = [];
      const { bindings } = createDialog(async (command, args) => {
        if (command === "get_settings") return defaults;
        saved.push(args);
      });
      await bindings.show();
      bindings.showPlaybackStatistics.value = enabled;
      await bindings.save();
      expect(saved).toEqual([{ settings: { ...defaults, showPlaybackStatistics: enabled } }]);
    });
  }

  for (const enabled of [false, true]) {
    it(`persists reduced motion ${enabled} and applies only after successful saving`, async () => {
      const saved: unknown[] = [];
      let fail = true;
      const { bindings, appliedMotion } = createDialog(async (command, args) => {
        if (command === "get_settings") return { ...defaults, reducedMotion: !enabled };
        if (fail) throw new Error("Disk unavailable");
        saved.push(args);
      });
      await bindings.show();
      expect(bindings.reducedMotion.value).toBe(!enabled);
      bindings.reducedMotion.value = enabled;
      expect(appliedMotion).toEqual([]);
      await bindings.save();
      expect(appliedMotion).toEqual([]);
      fail = false;
      await bindings.save();
      expect(saved).toEqual([{ settings: { ...defaults, reducedMotion: enabled } }]);
      expect(appliedMotion).toEqual([enabled]);
    });
  }

  for (const layoutDensity of ["regular", "compact"] as const) {
    it(`saves layout ${layoutDensity} and applies it only after success`, async () => {
      let fail = true;
      const saved: unknown[] = [];
      const { bindings, events } = createDialog(async (command, args) => {
        if (command === "get_settings") return defaults;
        if (fail) throw new Error("Disk unavailable");
        saved.push(args);
      });
      await bindings.show();
      expect(bindings.layoutDensity.value).toBe("regular");
      bindings.layoutDensity.value = layoutDensity;
      await bindings.save();
      expect(events).toEqual([]);
      fail = false;
      await bindings.save();
      expect(saved).toEqual([{ settings: { ...defaults, layoutDensity } }]);
      expect(events).toEqual([SETTINGS_CHANGED_EVENT]);
      await bindings.show();
      expect(bindings.layoutDensity.value).toBe("regular");
    });
  }

  it("persists disabled lyric providers", async () => {
    const saved: unknown[] = [];
    const { bindings } = createDialog(async (command, args) => {
      if (command === "get_settings") return defaults;
      saved.push(args);
    });
    await bindings.show();
    bindings.neteaseEnabled.value = false;
    await bindings.save();
    expect(saved).toEqual([{ settings: { ...defaults, lyricsProviders: [] } }]);
  });

  it("blocks saving when loading fails", async () => {
    const calls: string[] = [];
    const { bindings, element, events, feedback } = createDialog(async (command) => {
      calls.push(command);
      throw new Error("Unavailable");
    });
    await bindings.show();
    await bindings.save();
    expect(feedback).toEqual([
      { type: "error", message: "读取设置失败，请查看日志", key: "settings-load" },
    ]);
    expect(bindings.isLoaded.value).toBe(false);
    expect(element.open).toBe(true);
    expect(calls).toEqual(["get_settings"]);
    expect(events).toEqual([]);
  });

  it("keeps the dialog open and notifies save failures without applying settings", async () => {
    const { bindings, element, events, appliedColors, feedback } = createDialog(async (command) => {
      if (command === "get_settings") return defaults;
      throw new Error("Disk unavailable");
    });
    await bindings.show();
    bindings.accentColor.value = "#ABCDEF";
    await bindings.save();
    expect(element.open).toBe(true);
    expect(bindings.accentColor.value).toBe("#ABCDEF");
    expect(feedback).toEqual([
      { type: "error", message: "保存设置失败: Disk unavailable", key: "settings-save" },
    ]);
    expect(JSON.stringify(feedback)).toContain("Disk unavailable");
    expect(appliedColors).toEqual([]);
    expect(events).toEqual([]);
  });

  it("ignores stale loads after the dialog is reopened", async () => {
    const first = deferred<Settings>();
    const second = deferred<Settings>();
    let calls = 0;
    const { bindings } = createDialog(() => (++calls === 1 ? first.promise : second.promise));
    const firstShow = bindings.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);
    bindings.close();
    const secondShow = bindings.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(2);
    first.resolve({
      replayGain: true,
      replayGainPreamp: 0,
      scanReplayGain: false,
      themeMode: "light",
      lightweightOnClose: false,
      monitoringFolders: [],
      showPlaybackStatistics: false,
      layoutDensity: "regular",
      locale: "zh-CN",
      accentColor: "#60a5fa",
      reducedMotion: false,
      albumCoverBackground: true,
      playingCoverBackground: true,
      closeBehavior: "exit",
      albumSortBy: "year",
      albumSortOrder: "descending",
      lyricsProviders: ["netease"],
      neteaseLyricsMode: "translated",
      shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS),
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

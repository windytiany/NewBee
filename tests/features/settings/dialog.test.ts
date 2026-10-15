import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { locale, setLocale } from "@/shared/i18n/locale";
import { compileSfc, evaluateSource } from "../../support/module/loader";

import { HelpDialog } from "../../support/help/dialog";
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
} from "@/features/settings/shortcuts/bindings";
import * as AccentColor from "@/features/settings/accent";
import type { NotificationInput } from "@/shared/notifications/center";

type DialogBindings = {
  dialogElement: Vue.Ref<{ open: boolean; showModal: () => void; close: () => void }>;
  selectedCategory: Vue.Ref<
    "general" | "appearance" | "library" | "lyrics" | "shortcuts" | "diagnostics" | "backup"
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
  accentColor: Vue.Ref<Settings["accentColor"]>;
  reducedMotion: Vue.Ref<boolean>;
  layoutDensity: Vue.Ref<Settings["layoutDensity"]>;
  albumCoverBackground: Vue.Ref<boolean>;
  playingCoverBackground: Vue.Ref<boolean>;
  albumSortBy: Vue.Ref<Settings["albumSortBy"]>;
  albumSortOrder: Vue.Ref<Settings["albumSortOrder"]>;
  isLoaded: Vue.Ref<boolean>;
  isLoading: Vue.Ref<boolean>;
  isBackingUp: Vue.Ref<boolean>;
  show: () => Promise<void>;
  close: () => void;
  save: () => Promise<void>;
};
const defaults: Settings = {
  locale: "zh-CN",
  accentColor: AccentColor.DEFAULT_ACCENT_COLOR,
  reducedMotion: false,
  layoutDensity: "regular",
  albumCoverBackground: false,
  playingCoverBackground: false,
  closeBehavior: "tray",
  albumSortBy: "name",
  albumSortOrder: "ascending",
  lyricsProviders: ["netease"],
  neteaseLyricsMode: "original",
  shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS),
};

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
) {
  const events: string[] = [];
  const suspensions: boolean[] = [];
  const feedback: NotificationInput[] = [];
  const appliedColors: Settings["accentColor"][] = [];
  const appliedMotion: boolean[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (event: Event) => events.push(event.type) },
  });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/shared/notifications/center": { notify: (input: NotificationInput) => feedback.push(input) },
    "@/shared/components/HelpDialog.vue": HelpDialog,
    "@/features/backup/components/BackupOptions.vue": Vue.defineComponent({ template: "<div />" }),
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
  return { bindings, element, events, appliedColors, appliedMotion, feedback, suspensions };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("settings dialog", () => {
  it("blocks settings saving and closing while backup is pending", async () => {
    const calls: string[] = [];
    const { bindings, element } = createDialog(async (command) => {
      calls.push(command);
      return defaults;
    });
    await bindings.show();
    bindings.selectedCategory.value = "backup";
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
    expect(defaults.shortcuts.previous.shortcut).toBe("");
    expect(DEFAULT_SHORTCUTS.previous.shortcut).toBe("");
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
      "@/shared/notifications/center": {
        notify: (input: NotificationInput) => feedback.push(input),
      },
      "@/shared/components/HelpDialog.vue": HelpDialog,
      "@/features/backup/components/BackupOptions.vue": Vue.defineComponent({
        template: "<div />",
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
          addEventListener: () => {},
          removeEventListener: () => {},
          getRootNode: () => ({ activeElement: null }),
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
        if (!help || typeof help.props.onClick !== "function")
          throw new Error("Missing settings help");
        help.props.onClick();
        await Vue.nextTick();
        expect(getTextContent(panel)).toContain(explanation);
        const closeHelp = findNode(panel, (node) => node.props["aria-label"] === "关闭说明");
        if (!closeHelp || typeof closeHelp.props.onClick !== "function")
          throw new Error("Missing help close button");
        closeHelp.props.onClick();
        await Vue.nextTick();
        expect(getTextContent(panel)).not.toContain(explanation);
        if (category === "外观") {
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
      for (const label of ["上一首", "下一首", "播放/暂停", "窗口切换", "全局生效"])
        expect(getTextContent(panel)).toContain(label);
      const table = findNode(panel, (node) => node.type === "table");
      if (!table) throw new Error("Missing shortcut table");
      const rows = SHORTCUT_ACTIONS.map((action) => {
        const row = findNode(table, (node) => node.props["data-shortcut-action"] === action);
        if (!row) throw new Error("Missing shortcut action row");
        return row;
      });
      expect(rows).toHaveLength(4);
      const headings = findNode(table, (node) => node.type === "thead");
      expect(headings?.children[0]?.children.map((node) => getTextContent(node))).toEqual([
        "操作",
        "快捷键",
        "全局",
      ]);
      const recorders: HostNode[] = [];
      const collectRecorders = (node: HostNode) => {
        if (node.props["data-shortcut-recorder"] === "") recorders.push(node);
        node.children.forEach(collectRecorders);
      };
      collectRecorders(panel);
      expect(recorders).toHaveLength(1);
      const selectAction = async (action: ShortcutAction) => {
        const row = rows[SHORTCUT_ACTIONS.indexOf(action)]!;
        const button = findNode(row, (node) => node.type === "button");
        if (!button || typeof button.props.onClick !== "function")
          throw new Error("Missing action selector");
        button.props.onClick();
        await Vue.nextTick();
        expect(button.props["aria-pressed"]).toBe(true);
      };
      for (const action of SHORTCUT_ACTIONS) {
        await selectAction(action);
        const recorder = findNode(panel, (node) => node.props.name === "shortcut-recorder");
        if (!recorder || typeof recorder.props.onKeydown !== "function")
          throw new Error("Missing shortcut recorder");
        expect(recorder.props.readonly).toBe("");
        expect(recorder.props["data-shortcut-recorder"]).toBe("");
        expect(recorder.props.placeholder).toBeUndefined();
        expect(Reflect.get(recorder, "value")).toBe("");
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
        expect(Reflect.get(recorder, "value")).toBe("");
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
        try {
          recorder.props.onKeydown({
            key: "Escape",
            code: "Escape",
            isComposing: false,
            target: new Input(),
            preventDefault() {},
            stopPropagation() {},
          });
        } finally {
          if (originalInput) Object.defineProperty(globalThis, "HTMLInputElement", originalInput);
          else Reflect.deleteProperty(globalThis, "HTMLInputElement");
        }
        expect(blurred).toBe(true);
        expect(Reflect.get(recorder, "value")).toBe("Ctrl + A");
        press("Delete", "Delete");
        await Vue.nextTick();
        expect(Reflect.get(recorder, "value")).toBe("");
        press("a", "KeyA", true);
        await Vue.nextTick();
        const row = recorder.parent;
        if (!row) throw new Error("Missing shortcut row");
        const clear = findNode(row, (node) => node.type === "button");
        if (!clear || typeof clear.props.onClick !== "function") throw new Error("Missing clear");
        clear.props.onClick();
        await Vue.nextTick();
        expect(Reflect.get(recorder, "value")).toBe("");
        press("a", "KeyA", true);
        press("Backspace", "Backspace");
        await Vue.nextTick();
        expect(Reflect.get(recorder, "value")).toBe("");
      }
      await selectAction("previous");
      const previous = findNode(panel, (node) => node.props.name === "shortcut-recorder");
      const global = findNode(panel, (node) => node.props.name === "shortcuts-global");
      const form = findNode(root, (node) => node.type === "form");
      if (
        !previous ||
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
      expect(getTextContent(rows[0]!)).toContain("Ctrl + P");
      expect(getTextContent(rows[0]!)).toContain("全局");
      await selectAction("next");
      expect(Reflect.get(previous, "value")).toBe("");
      expect(Reflect.get(global, "checked")).toBe(false);
      previous.props.onKeydown({
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
      expect(getTextContent(rows[0]!)).toContain("Ctrl + P");
      expect(getTextContent(rows[1]!)).toContain("Ctrl + N");
      expect(getTextContent(rows[1]!)).not.toContain("全局");
      expect(getTextContent(rows[2]!)).not.toContain("Ctrl");
      expect(getTextContent(rows[3]!)).not.toContain("Ctrl");
      await selectAction("previous");
      expect(Reflect.get(previous, "value")).toBe("Ctrl + P");
      expect(Reflect.get(global, "checked")).toBe(true);
      const clearSelected = findNode(
        panel,
        (node) => node.type === "button" && getTextContent(node).trim() === "清除",
      );
      if (!clearSelected || typeof clearSelected.props.onClick !== "function")
        throw new Error("Missing clear selected shortcut");
      clearSelected.props.onClick();
      await Vue.nextTick();
      expect(Reflect.get(previous, "value")).toBe("");
      expect(Reflect.get(global, "checked")).toBe(true);
      expect(getTextContent(rows[1]!)).toContain("Ctrl + N");
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
      expect(Reflect.get(previous, "value")).toBe("Ctrl + N");
      expect(Reflect.get(global, "checked")).toBe(false);
      failSave = false;
      await form.props.onSubmit({ preventDefault() {} });
      expect(saved[0]?.shortcuts).toEqual({
        ...cloneShortcuts(DEFAULT_SHORTCUTS),
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
          findNode(panel, (node) => node.props.name === "shortcut-recorder")!,
          "value",
        ),
      ).toBe("Ctrl + P");
      const reopenedGlobal = findNode(panel, (node) => node.props.name === "shortcuts-global");
      expect(reopenedGlobal && Reflect.get(reopenedGlobal, "checked")).toBe(true);
      const reopenedNext = findNode(panel, (node) => node.props["data-shortcut-action"] === "next");
      const reopenedNextButton =
        reopenedNext && findNode(reopenedNext, (node) => node.type === "button");
      if (!reopenedNextButton || typeof reopenedNextButton.props.onClick !== "function")
        throw new Error("Missing reopened next action");
      reopenedNextButton.props.onClick();
      await Vue.nextTick();
      expect(
        Reflect.get(
          findNode(panel, (node) => node.props.name === "shortcut-recorder")!,
          "value",
        ),
      ).toBe("Ctrl + N");
      expect(reopenedGlobal && Reflect.get(reopenedGlobal, "checked")).toBe(false);
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

  it("loads and saves all settings and notifies the library after saving", async () => {
    const calls: Array<[string, unknown]> = [];
    const loaded: Settings = {
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
    expect(bindings.albumCoverBackground.value).toBe(true);
    expect(bindings.playingCoverBackground.value).toBe(true);
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
          locale: "zh-CN",
          layoutDensity: "regular",
          accentColor: "#60a5fa",
          reducedMotion: false,
          albumCoverBackground: true,
          playingCoverBackground: false,
          closeBehavior: "exit",
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

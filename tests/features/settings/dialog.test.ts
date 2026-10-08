import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";

import { HelpDialog } from "../../support/helpDialog";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/hostRenderer";
import type { HostNode } from "../../support/hostRenderer";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { Settings } from "@/features/settings/types";
import { THEMES } from "@/features/settings/theme";

type DialogBindings = {
  dialogElement: Vue.Ref<{ open: boolean; showModal: () => void; close: () => void }>;
  selectedCategory: Vue.Ref<"general" | "appearance" | "library" | "lyrics" | "diagnostics">;
  detailedLogging: Vue.Ref<boolean>;
  isChangingLogging: Vue.Ref<boolean>;
  changeLogging: () => Promise<void>;
  openLogs: () => Promise<void>;
  neteaseEnabled: Vue.Ref<boolean>;
  neteaseLyricsMode: Vue.Ref<Settings["neteaseLyricsMode"]>;
  closeBehavior: Vue.Ref<Settings["closeBehavior"]>;
  theme: Vue.Ref<Settings["theme"]>;
  reducedMotion: Vue.Ref<boolean>;
  albumCoverBackground: Vue.Ref<boolean>;
  playingCoverBackground: Vue.Ref<boolean>;
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
  reducedMotion: false,
  albumCoverBackground: false,
  playingCoverBackground: false,
  closeBehavior: "tray",
  albumSortBy: "name",
  albumSortOrder: "ascending",
  lyricsProviders: ["netease"],
  neteaseLyricsMode: "original",
};

const filename = "src/features/settings/components/SettingsDialog.vue";
const source = await Bun.file(
  new URL("../../../src/features/settings/components/SettingsDialog.vue", import.meta.url),
).text();
const output = compileSfc(source, filename, { id: "settings-dialog-test", inlineTemplate: false });
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function createDialog(invoke: (command: string, args?: unknown) => Promise<unknown>) {
  const events: string[] = [];
  const appliedThemes: Settings["theme"][] = [];
  const appliedMotion: boolean[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (event: Event) => events.push(event.type) },
  });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/shared/components/HelpDialog.vue": HelpDialog,
    "@tauri-apps/api/core": { invoke, isTauri: () => true },
    "@/features/settings/events": { SETTINGS_CHANGED_EVENT },
    "@/features/settings/theme": { THEMES },
    "@/features/settings/appearance": {
      applyAppearance: (settings: Settings) => {
        appliedThemes.push(settings.theme);
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
  return { bindings, element, events, appliedThemes, appliedMotion };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("settings dialog", () => {
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

  it("keeps diagnostic failures inline, rolls back the toggle and permits retry", async () => {
    let fail = true;
    const { bindings } = createDialog(async (command) => {
      if (command === "get_settings") return defaults;
      if (fail) throw new Error("permission denied");
    });
    await bindings.show();
    await bindings.openLogs();
    expect(bindings.error.value).toContain("打开日志目录失败");
    bindings.detailedLogging.value = true;
    await bindings.changeLogging();
    expect(bindings.detailedLogging.value).toBe(false);
    expect(bindings.error.value).toContain("切换日志级别失败");
    expect(bindings.isChangingLogging.value).toBe(false);
    fail = false;
    bindings.detailedLogging.value = true;
    await bindings.changeLogging();
    expect(bindings.detailedLogging.value).toBe(true);
  });

  it("renders settings with category navigation and only cancel/save footer actions", async () => {
    const modules: Record<string, unknown> = {
      vue: Vue,
      "@/shared/components/HelpDialog.vue": HelpDialog,
      "@tauri-apps/api/core": { invoke: async () => defaults, isTauri: () => true },
      "@/features/settings/events": { SETTINGS_CHANGED_EVENT },
      "@/features/settings/theme": { THEMES },
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
      for (const [category, included, excluded] of [
        ["常规", "关闭窗口时", "主题"],
        ["外观", "主题", "专辑排序"],
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
    } finally {
      app.unmount();
    }
  });

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
      reducedMotion: false,
      albumCoverBackground: true,
      playingCoverBackground: true,
      closeBehavior: "exit",
      albumSortBy: "year",
      albumSortOrder: "descending",
      lyricsProviders: ["netease"],
      neteaseLyricsMode: "translated",
    };
    const { bindings, element, events } = createDialog(async (command, args) => {
      calls.push([command, args]);
      return command === "get_settings" ? loaded : undefined;
    });
    await bindings.show();
    expect(bindings.closeBehavior.value).toBe("exit");
    expect(bindings.theme.value).toBe("tokyoNight");
    expect(bindings.albumCoverBackground.value).toBe(true);
    expect(bindings.playingCoverBackground.value).toBe(true);
    expect(bindings.albumSortBy.value).toBe("year");
    expect(bindings.albumSortOrder.value).toBe("descending");
    expect(bindings.neteaseLyricsMode.value).toBe("translated");
    expect(element.open).toBe(true);
    expect(events).toEqual([]);
    bindings.theme.value = "spotify";
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
    const { bindings, events, appliedThemes } = createDialog(async (command) => {
      calls.push(command);
      return defaults;
    });
    await bindings.show();
    bindings.closeBehavior.value = "exit";
    bindings.albumSortBy.value = "year";
    bindings.albumSortOrder.value = "descending";
    bindings.theme.value = "catppuccin";
    bindings.albumCoverBackground.value = true;
    bindings.playingCoverBackground.value = true;
    bindings.neteaseLyricsMode.value = "translated";
    bindings.selectedCategory.value = "appearance";
    bindings.close();
    await bindings.show();
    expect<DialogBindings["selectedCategory"]["value"]>(bindings.selectedCategory.value).toBe(
      "general",
    );
    expect<Settings["theme"]>(bindings.theme.value).toBe("spotify");
    expect(bindings.albumCoverBackground.value).toBe(false);
    expect(bindings.playingCoverBackground.value).toBe(false);
    expect<Settings["neteaseLyricsMode"]>(bindings.neteaseLyricsMode.value).toBe("original");
    expect(appliedThemes).toEqual([]);
    expect<Settings["closeBehavior"]>(bindings.closeBehavior.value).toBe("tray");
    expect<Settings["albumSortBy"]>(bindings.albumSortBy.value).toBe("name");
    expect<Settings["albumSortOrder"]>(bindings.albumSortOrder.value).toBe("ascending");
    expect(calls).toEqual(["get_settings", "get_settings"]);
    expect(events).toEqual([]);
  });

  it("preserves edits across categories and saves all categories together", async () => {
    const saved: unknown[] = [];
    const { bindings, appliedThemes } = createDialog(async (command, args) => {
      if (command === "get_settings") return defaults;
      saved.push(args);
    });
    await bindings.show();
    expect(bindings.selectedCategory.value).toBe("general");
    bindings.closeBehavior.value = "exit";
    bindings.selectedCategory.value = "appearance";
    bindings.theme.value = "tokyoNight";
    bindings.albumCoverBackground.value = true;
    bindings.selectedCategory.value = "library";
    bindings.albumSortBy.value = "year";
    bindings.albumSortOrder.value = "descending";
    bindings.neteaseLyricsMode.value = "bilingual";
    bindings.selectedCategory.value = "general";
    expect(bindings.closeBehavior.value).toBe("exit");
    expect(bindings.theme.value).toBe("tokyoNight");
    expect(saved).toEqual([]);
    expect(appliedThemes).toEqual([]);

    await bindings.save();

    expect(saved).toEqual([
      {
        settings: {
          theme: "tokyoNight",
          reducedMotion: false,
          albumCoverBackground: true,
          playingCoverBackground: false,
          closeBehavior: "exit",
          albumSortBy: "year",
          albumSortOrder: "descending",
          lyricsProviders: ["netease"],
          neteaseLyricsMode: "bilingual",
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
    const { bindings, element, events } = createDialog(async (command) => {
      calls.push(command);
      throw new Error("Unavailable");
    });
    await bindings.show();
    await bindings.save();
    expect(bindings.error.value).toContain("读取设置失败");
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
      reducedMotion: false,
      albumCoverBackground: true,
      playingCoverBackground: true,
      closeBehavior: "exit",
      albumSortBy: "year",
      albumSortOrder: "descending",
      lyricsProviders: ["netease"],
      neteaseLyricsMode: "translated",
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

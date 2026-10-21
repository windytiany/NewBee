import { cleanupEditor } from "../../support/settings/editor";
import { afterEach, describe, expect, it } from "bun:test";
import {
  createEditor,
  defaults,
  deferred,
  type EditorBindings,
} from "../../support/settings/editor";

import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { Settings } from "@/features/settings/types";
import { cloneShortcuts, DEFAULT_SHORTCUTS } from "@/features/shortcuts/bindings";
import * as AccentColor from "@/features/settings/appearance/accent";

describe("settings editor", () => {
  it("opens About and preserves an already open settings draft", async () => {
    let loads = 0;
    const { bindings } = createEditor(async () => {
      loads++;
      return defaults;
    });
    await bindings.show("about");
    expect(bindings.selectedCategory.value).toBe("about");
    expect(loads).toBe(1);
    bindings.selectedCategory.value = "appearance";
    bindings.draft.lightweightOnClose = true;
    await bindings.show();
    expect(bindings.selectedCategory.value).toBe("appearance");
    await bindings.show("about");
    expect(String(bindings.selectedCategory.value)).toBe("about");
    expect(bindings.draft.lightweightOnClose).toBe(true);
    expect(loads).toBe(1);
  });

  it("loads and saves all settings and notifies the library after saving", async () => {
    const calls: Array<[string, unknown]> = [];
    const loaded: Settings = {
      replayGain: true,
      replayGainPreamp: 0,
      scanReplayGain: false,
      themeMode: "dark",
      lightweightOnClose: false,
      checkUpdatesOnStartup: true,
      synchronizationFolders: [],
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
    const { bindings, element, events } = createEditor(async (command, args) => {
      calls.push([command, args]);
      return command === "get_settings" ? loaded : undefined;
    });
    await bindings.show();
    expect(bindings.draft.closeBehavior).toBe("exit");
    expect(bindings.draft.accentColor).toBe("#60a5fa");
    expect(bindings.draft.themeMode).toBe("dark");
    bindings.draft.themeMode = "system";
    expect(bindings.draft.albumCoverBackground).toBe(true);
    expect(bindings.draft.playingCoverBackground).toBe(true);
    expect(bindings.draft.showPlaybackStatistics).toBe(false);
    bindings.draft.showPlaybackStatistics = true;
    expect(bindings.draft.albumSortBy).toBe("year");
    expect(bindings.draft.albumSortOrder).toBe("descending");
    expect(bindings.draft.neteaseLyricsMode).toBe("translated");
    expect(element.open).toBe(true);
    expect(events).toEqual([]);
    bindings.draft.accentColor = AccentColor.DEFAULT_ACCENT_COLOR;
    bindings.draft.albumCoverBackground = false;
    bindings.draft.playingCoverBackground = false;
    bindings.draft.closeBehavior = "tray";
    bindings.draft.albumSortBy = "name";
    bindings.draft.albumSortOrder = "ascending";
    bindings.draft.neteaseLyricsMode = "bilingual";
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
    const { bindings, events, appliedColors } = createEditor(async (command) => {
      calls.push(command);
      return defaults;
    });
    await bindings.show();
    bindings.draft.closeBehavior = "exit";
    bindings.draft.albumSortBy = "year";
    bindings.draft.albumSortOrder = "descending";
    bindings.draft.accentColor = "#a78bfa";
    bindings.draft.albumCoverBackground = true;
    bindings.draft.playingCoverBackground = true;
    bindings.draft.neteaseLyricsMode = "translated";
    bindings.selectedCategory.value = "appearance";
    bindings.close();
    expect(appliedColors).toEqual([]);
    expect(calls).toEqual(["get_settings"]);
    expect(events).toEqual([]);
    await bindings.show();
    expect<EditorBindings["selectedCategory"]["value"]>(bindings.selectedCategory.value).toBe(
      "general",
    );
    expect<Settings["accentColor"]>(bindings.draft.accentColor).toBe(
      AccentColor.DEFAULT_ACCENT_COLOR,
    );
    expect(bindings.draft.albumCoverBackground).toBe(false);
    expect(bindings.draft.playingCoverBackground).toBe(false);
    expect<Settings["neteaseLyricsMode"]>(bindings.draft.neteaseLyricsMode).toBe("original");
    expect(appliedColors).toEqual([]);
    expect<Settings["closeBehavior"]>(bindings.draft.closeBehavior).toBe("tray");
    expect<Settings["albumSortBy"]>(bindings.draft.albumSortBy).toBe("name");
    expect<Settings["albumSortOrder"]>(bindings.draft.albumSortOrder).toBe("ascending");
    expect(calls).toEqual(["get_settings", "get_settings"]);
    expect(events).toEqual([]);
  });

  it("preserves edits across categories and saves all categories together", async () => {
    const saved: unknown[] = [];
    const { bindings, appliedColors } = createEditor(async (command, args) => {
      if (command === "get_settings") return defaults;
      saved.push(args);
    });
    await bindings.show();
    expect(bindings.selectedCategory.value).toBe("general");
    bindings.draft.closeBehavior = "exit";
    bindings.selectedCategory.value = "appearance";
    bindings.draft.accentColor = "#60a5fa";
    bindings.draft.albumCoverBackground = true;
    bindings.selectedCategory.value = "library";
    bindings.draft.albumSortBy = "year";
    bindings.draft.albumSortOrder = "descending";
    bindings.draft.neteaseLyricsMode = "bilingual";
    bindings.selectedCategory.value = "general";
    expect(bindings.draft.closeBehavior).toBe("exit");
    expect(bindings.draft.accentColor).toBe("#60a5fa");
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
          checkUpdatesOnStartup: true,
          showPlaybackStatistics: true,
          replayGain: true,
          replayGainPreamp: 0,
          scanReplayGain: false,
          synchronizationFolders: [],
          albumSortBy: "year",
          albumSortOrder: "descending",
          lyricsProviders: ["netease"],
          neteaseLyricsMode: "bilingual",
          shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS),
        },
      },
    ]);
  });

  it("blocks saving when loading fails", async () => {
    const calls: string[] = [];
    const { bindings, element, events, feedback } = createEditor(async (command) => {
      calls.push(command);
      throw new Error("Unavailable");
    });
    await bindings.show();
    await bindings.save();
    expect(feedback).toEqual([{ type: "error", message: "读取设置失败", key: "settings-load" }]);
    expect(bindings.isLoaded.value).toBe(false);
    expect(element.open).toBe(true);
    expect(calls).toEqual(["get_settings"]);
    expect(events).toEqual([]);
  });

  it("keeps the dialog open and notifies save failures without applying settings", async () => {
    const { bindings, element, events, appliedColors, feedback } = createEditor(async (command) => {
      if (command === "get_settings") return defaults;
      throw new Error("Disk unavailable");
    });
    await bindings.show();
    bindings.draft.accentColor = "#ABCDEF";
    await bindings.save();
    expect(element.open).toBe(true);
    expect(bindings.draft.accentColor).toBe("#ABCDEF");
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
    const { bindings } = createEditor(() => (++calls === 1 ? first.promise : second.promise));
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
      checkUpdatesOnStartup: true,
      synchronizationFolders: [],
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
    expect(bindings.draft.closeBehavior).toBe("tray");
    expect(bindings.draft.albumSortBy).toBe("name");
    expect(bindings.draft.albumSortOrder).toBe("ascending");
    expect(bindings.isLoading.value).toBe(false);
  });

  it("blocks duplicate saves and closing during a save", async () => {
    const saving = deferred<void>();
    let saves = 0;
    const { bindings, element, events } = createEditor(async (command) => {
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

afterEach(cleanupEditor);

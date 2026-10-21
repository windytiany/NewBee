import { cleanupEditor } from "../../../support/settings/editor";
import { afterEach, describe, expect, it } from "bun:test";
import { createEditor, defaults } from "../../../support/settings/editor";

import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";

import * as AccentColor from "@/features/settings/appearance/accent";

describe("settings appearance/editor", () => {
  for (const themeMode of ["system", "light", "dark"] as const) {
    it(`persists and applies ${themeMode} theme only after saving`, async () => {
      const saved: unknown[] = [];
      const { bindings, appliedThemes } = createEditor(async (command, args) => {
        if (command === "get_settings") return { ...defaults, themeMode: "dark" };
        saved.push(args);
      });
      await bindings.show();
      expect(bindings.draft.themeMode).toBe("dark");
      bindings.draft.themeMode = themeMode;
      expect(appliedThemes).toEqual([]);
      await bindings.save();
      expect(saved).toEqual([{ settings: { ...defaults, themeMode } }]);
      expect(appliedThemes).toEqual([themeMode]);
    });
  }

  for (const option of AccentColor.ACCENT_COLORS) {
    it(`persists and applies ${option.value} only after saving`, async () => {
      const calls: unknown[] = [];
      const { bindings, appliedColors } = createEditor(async (command, args) => {
        if (command === "get_settings") return defaults;
        calls.push(args);
      });
      await bindings.show();
      bindings.draft.accentColor = option.value;
      expect(appliedColors).toEqual([]);
      await bindings.save();
      expect(calls).toEqual([{ settings: { ...defaults, accentColor: option.value } }]);
      expect(appliedColors).toEqual([option.value]);
    });
  }

  it("normalizes a custom uppercase color before saving and applying it", async () => {
    const saved: unknown[] = [];
    const { bindings, element, events, appliedColors } = createEditor(async (command, args) => {
      if (command === "get_settings") return defaults;
      saved.push(args);
    });
    await bindings.show();
    bindings.draft.accentColor = "#ABCDEF";
    expect(appliedColors).toEqual([]);
    await bindings.save();
    expect(saved).toEqual([{ settings: { ...defaults, accentColor: "#abcdef" } }]);
    expect(bindings.draft.accentColor).toBe("#abcdef");
    expect(appliedColors).toEqual(["#abcdef"]);
    expect(events).toEqual([SETTINGS_CHANGED_EVENT]);
    expect(element.open).toBe(false);
  });

  for (const invalidColor of ["", "#abc", "#12345678", "#gggggg", "123456"]) {
    it(`blocks saving invalid accent color ${JSON.stringify(invalidColor)} without discarding edits`, async () => {
      const calls: string[] = [];
      const { bindings, element, events, appliedColors, feedback } = createEditor(
        async (command) => {
          calls.push(command);
          return defaults;
        },
      );
      await bindings.show();
      bindings.draft.accentColor = invalidColor;
      bindings.draft.closeBehavior = "exit";
      await bindings.save();
      expect(calls).toEqual(["get_settings"]);
      expect(element.open).toBe(true);
      expect(bindings.isLoaded.value).toBe(true);
      expect(bindings.draft.accentColor).toBe(invalidColor);
      expect(bindings.draft.closeBehavior).toBe("exit");
      expect(appliedColors).toEqual([]);
      expect(events).toEqual([]);
      expect(feedback).toEqual([
        { type: "error", message: "主题色必须是有效的 #RRGGBB 颜色", key: "settings-accent-color" },
      ]);
    });
  }

  for (const albumEnabled of [false, true]) {
    for (const playingEnabled of [false, true]) {
      it(`saves album background ${albumEnabled} and playing background ${playingEnabled} independently`, async () => {
        const saved: unknown[] = [];
        const loaded = {
          ...defaults,
          albumCoverBackground: albumEnabled,
          playingCoverBackground: playingEnabled,
        };
        const { bindings } = createEditor(async (command, args) => {
          if (command === "get_settings") return loaded;
          saved.push(args);
        });
        await bindings.show();
        expect(bindings.draft.albumCoverBackground).toBe(albumEnabled);
        expect(bindings.draft.playingCoverBackground).toBe(playingEnabled);
        await bindings.save();
        expect(saved).toEqual([{ settings: loaded }]);
      });
    }
  }

  for (const enabled of [false, true]) {
    it(`persists reduced motion ${enabled} and applies only after successful saving`, async () => {
      const saved: unknown[] = [];
      let fail = true;
      const { bindings, appliedMotion } = createEditor(async (command, args) => {
        if (command === "get_settings") return { ...defaults, reducedMotion: !enabled };
        if (fail) throw new Error("Disk unavailable");
        saved.push(args);
      });
      await bindings.show();
      expect(bindings.draft.reducedMotion).toBe(!enabled);
      bindings.draft.reducedMotion = enabled;
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
      const { bindings, events } = createEditor(async (command, args) => {
        if (command === "get_settings") return defaults;
        if (fail) throw new Error("Disk unavailable");
        saved.push(args);
      });
      await bindings.show();
      expect(bindings.draft.layoutDensity).toBe("regular");
      bindings.draft.layoutDensity = layoutDensity;
      await bindings.save();
      expect(events).toEqual([]);
      fail = false;
      await bindings.save();
      expect(saved).toEqual([{ settings: { ...defaults, layoutDensity } }]);
      expect(events).toEqual([SETTINGS_CHANGED_EVENT]);
      await bindings.show();
      expect(bindings.draft.layoutDensity).toBe("regular");
    });
  }
});

afterEach(cleanupEditor);

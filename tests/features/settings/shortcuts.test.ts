import { cleanupEditor } from "../../support/settings/editor";
import { afterEach, describe, expect, it } from "bun:test";
import { createEditor, defaults } from "../../support/settings/editor";

import type { Settings } from "@/features/settings/types";
import { cloneShortcuts, DEFAULT_SHORTCUTS } from "@/features/shortcuts/bindings";
import * as Vue from "vue";
import { useRecorder } from "@/features/shortcuts/useRecorder";

describe("settings shortcuts", () => {
  it("restores the draft immediately, discards it on cancel and persists only on save", async () => {
    const persisted = { ...defaults, shortcuts: cloneShortcuts({}) };
    const saved: Settings[] = [];
    const { bindings } = createEditor(async (command, args) => {
      if (command === "get_settings") return persisted;
      if (command === "save_settings") saved.push((args as { settings: Settings }).settings);
    });
    const recorder = useRecorder(Vue.toRef(bindings.draft, "shortcuts"));
    await bindings.show();
    expect(bindings.draft.shortcuts.togglePlayback.shortcut).toBe("");
    recorder.resetShortcuts();
    expect(saved).toEqual([]);
    bindings.close();
    await bindings.show();
    expect(bindings.draft.shortcuts.togglePlayback.shortcut).toBe("");
    recorder.resetShortcuts();
    expect(bindings.draft.shortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(persisted.shortcuts.togglePlayback.shortcut).toBe("");
    bindings.draft.shortcuts.toggleWindow.global = true;
    expect(DEFAULT_SHORTCUTS.toggleWindow.global).toBe(false);
    await bindings.save();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.shortcuts.togglePlayback.shortcut).toBe("Space");
  });

  it("clears with Escape in the draft without changing scope and persists only on save", async () => {
    const persisted = { ...defaults, shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS) };
    persisted.shortcuts.previous.global = true;
    const saved: Settings[] = [];
    const { bindings, element } = createEditor(async (command, args) => {
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
    const recorder = useRecorder(Vue.toRef(bindings.draft, "shortcuts"));
    await bindings.show();
    recorder.recordShortcut(escape);
    expect(bindings.draft.shortcuts.previous).toEqual({ shortcut: "", global: true });
    expect(element.open).toBe(true);
    expect(saved).toEqual([]);
    expect(persisted.shortcuts.previous.shortcut).toBe(DEFAULT_SHORTCUTS.previous.shortcut);
    bindings.close();
    await bindings.show();
    expect(bindings.draft.shortcuts.previous.shortcut).toBe(DEFAULT_SHORTCUTS.previous.shortcut);
    recorder.recordShortcut(escape);
    await bindings.save();
    expect(saved[0]?.shortcuts.previous).toEqual({ shortcut: "", global: true });
  });
});

afterEach(cleanupEditor);

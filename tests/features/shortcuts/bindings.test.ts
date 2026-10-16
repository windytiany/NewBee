import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SHORTCUTS,
  cloneShortcuts,
  formatShortcut,
  shortcutFromEvent,
  SHORTCUT_ACTIONS,
  SHORTCUT_DEFINITIONS,
  allowsGlobalShortcut,
} from "@/features/shortcuts/bindings";
import type { ShortcutKeyEvent } from "@/features/shortcuts/bindings";

function keyEvent(overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    code: "KeyK",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
  };
}

describe("shortcut bindings", () => {
  it("provides unique local defaults for core operations", () => {
    expect(DEFAULT_SHORTCUTS.togglePlayback.shortcut).toBe("Space");
    expect(DEFAULT_SHORTCUTS.showCommands.shortcut).toBe("Ctrl+KeyK");
    expect(DEFAULT_SHORTCUTS.showSettings.shortcut).toBe("Ctrl+Comma");
    const bindings = Object.values(DEFAULT_SHORTCUTS);
    expect(bindings.every((binding) => !binding.global)).toBe(true);
    const keys = bindings.map((binding) => binding.shortcut).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("limits global scope by command semantics", () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(allowsGlobalShortcut(action)).toBe(
        !action.startsWith("show") && action !== "addToQueue",
      );
    }
    expect(SHORTCUT_DEFINITIONS.seekForward.repeat).toBe(true);
    expect(SHORTCUT_DEFINITIONS.volumeUp.repeat).toBe(true);
    expect(SHORTCUT_DEFINITIONS.toggleShuffle.repeat).toBe(false);
  });

  it("keeps missing legacy actions and explicitly cleared bindings empty", () => {
    const legacy = cloneShortcuts({ previous: { shortcut: "", global: false } });
    expect(legacy.previous.shortcut).toBe("");
    expect(legacy.showCommands.shortcut).toBe("");
    expect(Object.keys(legacy)).toEqual(SHORTCUT_ACTIONS);
  });

  it("clones each action independently from defaults and saved configuration", () => {
    const saved = cloneShortcuts(DEFAULT_SHORTCUTS);
    saved.previous = { shortcut: "Ctrl+KeyP", global: true };
    const draft = cloneShortcuts(saved);
    draft.previous.shortcut = "Ctrl+KeyN";
    draft.previous.global = false;
    draft.next.global = true;
    expect(saved.previous).toEqual({ shortcut: "Ctrl+KeyP", global: true });
    expect(saved.next).toEqual({ shortcut: "Ctrl+Shift+ArrowRight", global: false });
    expect(DEFAULT_SHORTCUTS.previous).toEqual({ shortcut: "Ctrl+Shift+ArrowLeft", global: false });
    expect(DEFAULT_SHORTCUTS.next).toEqual({ shortcut: "Ctrl+Shift+ArrowRight", global: false });
  });

  it("captures physical code and canonical Ctrl Alt Shift Super order", () => {
    expect(shortcutFromEvent(keyEvent())).toBe("KeyK");
    expect(
      shortcutFromEvent(keyEvent({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })),
    ).toBe("Ctrl+Alt+Shift+Super+KeyK");
    for (const [modifier, prefix] of [
      ["ctrlKey", "Ctrl"],
      ["altKey", "Alt"],
      ["shiftKey", "Shift"],
      ["metaKey", "Super"],
    ] as const) {
      expect(shortcutFromEvent(keyEvent({ [modifier]: true }))).toBe(`${prefix}+KeyK`);
    }
  });

  for (const code of [
    "Digit0",
    "Digit9",
    "Numpad0",
    "Numpad9",
    "F1",
    "F24",
    "Space",
    "ArrowLeft",
    "NumpadAdd",
    "MediaPlayPause",
    "AudioVolumeMute",
    "Escape",
    "BracketLeft",
  ]) {
    it(`captures supported code ${code}`, () => {
      expect(shortcutFromEvent(keyEvent({ code }))).toBe(code);
    });
  }

  for (const code of [
    "ControlLeft",
    "ControlRight",
    "AltLeft",
    "AltRight",
    "ShiftLeft",
    "ShiftRight",
    "MetaLeft",
    "MetaRight",
    "",
    "Unidentified",
    "Keya",
    "KeyAA",
    "Digit10",
    "F0",
    "F25",
    "Numpad10",
    "Unsupported",
  ]) {
    it(`rejects modifier-only or invalid code ${code}`, () => {
      expect(shortcutFromEvent(keyEvent({ code, ctrlKey: true }))).toBeNull();
    });
  }

  it("ignores composing events even with a supported code", () => {
    expect(shortcutFromEvent(keyEvent({ isComposing: true }))).toBeNull();
  });

  it("formats letters, digits and Super without changing stored bindings", () => {
    expect(formatShortcut("Ctrl+Alt+Shift+Super+KeyK")).toBe("Ctrl + Alt + Shift + Meta + K");
    expect(formatShortcut("Super+Digit7")).toBe("Meta + 7");
    expect(formatShortcut("Shift+Numpad7")).toBe("Shift + Numpad7");
    expect(formatShortcut("Alt+ArrowLeft")).toBe("Alt + ArrowLeft");
    expect(formatShortcut("F24")).toBe("F24");
    expect(formatShortcut("")).toBe("");
  });
});

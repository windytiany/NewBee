import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SHORTCUTS,
  cloneShortcuts,
  formatShortcut,
  shortcutFromEvent,
} from "@/features/settings/shortcuts/bindings";
import type { ShortcutKeyEvent } from "@/features/settings/shortcuts/bindings";

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
  it("defaults to local mode without bindings", () => {
    expect(DEFAULT_SHORTCUTS).toEqual({
      previous: { shortcut: "", global: false },
      next: { shortcut: "", global: false },
      togglePlayback: { shortcut: "", global: false },
      toggleWindow: { shortcut: "", global: false },
    });
  });

  it("clones each action independently from defaults and saved configuration", () => {
    const saved = cloneShortcuts(DEFAULT_SHORTCUTS);
    saved.previous = { shortcut: "Ctrl+KeyP", global: true };
    const draft = cloneShortcuts(saved);
    draft.previous.shortcut = "Ctrl+KeyN";
    draft.previous.global = false;
    draft.next.global = true;
    expect(saved.previous).toEqual({ shortcut: "Ctrl+KeyP", global: true });
    expect(saved.next).toEqual({ shortcut: "", global: false });
    expect(DEFAULT_SHORTCUTS.previous).toEqual({ shortcut: "", global: false });
    expect(DEFAULT_SHORTCUTS.next).toEqual({ shortcut: "", global: false });
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

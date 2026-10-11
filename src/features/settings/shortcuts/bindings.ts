import type { ShortcutSettings } from "@/features/settings/types";

export type ShortcutAction = "previous" | "next" | "togglePlayback" | "toggleWindow";
export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing"
>;

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  "previous",
  "next",
  "togglePlayback",
  "toggleWindow",
];

export const DEFAULT_SHORTCUTS: ShortcutSettings = Object.freeze({
  previous: Object.freeze({ shortcut: "", global: false }),
  next: Object.freeze({ shortcut: "", global: false }),
  togglePlayback: Object.freeze({ shortcut: "", global: false }),
  toggleWindow: Object.freeze({ shortcut: "", global: false }),
});

export function cloneShortcuts(settings: ShortcutSettings): ShortcutSettings {
  return {
    previous: { ...settings.previous },
    next: { ...settings.next },
    togglePlayback: { ...settings.togglePlayback },
    toggleWindow: { ...settings.toggleWindow },
  };
}

const supportedCodes = new Set([
  "Backquote",
  "Backslash",
  "BracketLeft",
  "BracketRight",
  "Pause",
  "Comma",
  "Equal",
  "Minus",
  "Period",
  "Quote",
  "Semicolon",
  "Slash",
  "Backspace",
  "CapsLock",
  "Enter",
  "Space",
  "Tab",
  "Delete",
  "End",
  "Home",
  "Insert",
  "PageDown",
  "PageUp",
  "PrintScreen",
  "ScrollLock",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "NumLock",
  "NumpadAdd",
  "NumpadDecimal",
  "NumpadDivide",
  "NumpadEnter",
  "NumpadEqual",
  "NumpadMultiply",
  "NumpadSubtract",
  "Escape",
  "AudioVolumeDown",
  "AudioVolumeUp",
  "AudioVolumeMute",
  "MediaPlay",
  "MediaPause",
  "MediaPlayPause",
  "MediaStop",
  "MediaTrackNext",
  "MediaTrackPrevious",
]);

function isSupportedCode(code: string) {
  return (
    supportedCodes.has(code) ||
    /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(code)
  );
}

export function shortcutFromEvent(event: ShortcutKeyEvent): string | null {
  if (event.isComposing || !isSupportedCode(event.code)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(event.code);
  return parts.join("+");
}

export function formatShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      if (/^Key[A-Z]$/.test(part)) return part.slice(3);
      if (/^Digit[0-9]$/.test(part)) return part.slice(5);
      if (part === "Super") return "Meta";
      return part;
    })
    .join(" + ");
}

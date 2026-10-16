import type { ShortcutSettings } from "@/features/settings/types";

export const SHORTCUT_PAGES = {
  showPlaying: "Playing",
  showLibrary: "Library",
  showPlaylist: "Playlist",
  showInbox: "Inbox",
} as const;
export type PageShortcutAction = keyof typeof SHORTCUT_PAGES;
export const SHORTCUT_DEFINITIONS = {
  previous: { label: "上一首", shortcut: "Ctrl+Shift+ArrowLeft", global: true, repeat: false },
  next: { label: "下一首", shortcut: "Ctrl+Shift+ArrowRight", global: true, repeat: false },
  togglePlayback: { label: "播放/暂停", shortcut: "Space", global: true, repeat: false },
  seekBackward: { label: "后退 5 秒", shortcut: "Ctrl+ArrowLeft", global: true, repeat: true },
  seekForward: { label: "前进 5 秒", shortcut: "Ctrl+ArrowRight", global: true, repeat: true },
  volumeDown: { label: "降低音量", shortcut: "Ctrl+ArrowDown", global: true, repeat: true },
  volumeUp: { label: "提高音量", shortcut: "Ctrl+ArrowUp", global: true, repeat: true },
  toggleMute: { label: "静音", shortcut: "Ctrl+Shift+KeyM", global: true, repeat: false },
  toggleShuffle: { label: "随机播放", shortcut: "Ctrl+Shift+KeyS", global: true, repeat: false },
  toggleRepeat: { label: "单曲循环", shortcut: "Ctrl+Shift+KeyR", global: true, repeat: false },
  toggleWindow: { label: "窗口切换", shortcut: "", global: true, repeat: false },
  showPlaying: { label: "正在播放", shortcut: "Ctrl+Digit1", global: false, repeat: false },
  showLibrary: { label: "音乐库", shortcut: "Ctrl+Digit2", global: false, repeat: false },
  showPlaylist: { label: "播放列表", shortcut: "Ctrl+Digit3", global: false, repeat: false },
  showInbox: { label: "Inbox", shortcut: "Ctrl+Digit4", global: false, repeat: false },
  showSettings: { label: "设置", shortcut: "Ctrl+Comma", global: false, repeat: false },
  showCommands: { label: "命令面板", shortcut: "Ctrl+KeyK", global: false, repeat: false },
  showShortcuts: { label: "快捷键总览", shortcut: "Ctrl+Slash", global: false, repeat: false },
  addToQueue: { label: "添加到队尾", shortcut: "Ctrl+Enter", global: false, repeat: false },
} as const;
export type ShortcutAction = keyof typeof SHORTCUT_DEFINITIONS;

export function allowsGlobalShortcut(action: ShortcutAction): boolean {
  return SHORTCUT_DEFINITIONS[action].global;
}

export function isPageShortcut(action: ShortcutAction): action is PageShortcutAction {
  return Object.prototype.hasOwnProperty.call(SHORTCUT_PAGES, action);
}
export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing"
>;

export const SHORTCUT_ACTIONS = Object.keys(SHORTCUT_DEFINITIONS) as ShortcutAction[];

export const DEFAULT_SHORTCUTS: ShortcutSettings = Object.freeze(
  Object.fromEntries(
    SHORTCUT_ACTIONS.map((action) => [
      action,
      Object.freeze({ shortcut: SHORTCUT_DEFINITIONS[action].shortcut, global: false }),
    ]),
  ) as ShortcutSettings,
);

export function cloneShortcuts(settings: Partial<ShortcutSettings>): ShortcutSettings {
  return Object.fromEntries(
    SHORTCUT_ACTIONS.map((action) => [
      action,
      { shortcut: "", global: false, ...settings[action] },
    ]),
  ) as ShortcutSettings;
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

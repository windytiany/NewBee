import { ref, type Ref } from "vue";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  SHORTCUT_DEFINITIONS,
  cloneShortcuts,
  shortcutFromEvent,
  type ShortcutAction,
} from "@/features/shortcuts/bindings";
import type { Settings } from "@/features/settings/types";

export function useRecorder(shortcuts: Ref<Settings["shortcuts"]>) {
  const selectedShortcutAction = ref<ShortcutAction>("previous");
  const shortcutLabels = Object.fromEntries(
    SHORTCUT_ACTIONS.map((action) => [action, SHORTCUT_DEFINITIONS[action].label]),
  ) as Record<ShortcutAction, string>;
  function resetShortcuts() {
    shortcuts.value = cloneShortcuts(DEFAULT_SHORTCUTS);
  }

  function resetShortcut(action: ShortcutAction) {
    shortcuts.value[action] = { ...DEFAULT_SHORTCUTS[action] };
  }

  function recordShortcut(
    event: InstanceType<typeof globalThis.KeyboardEvent>,
    action: ShortcutAction = selectedShortcutAction.value,
  ) {
    if (event.isComposing || event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (
      (event.key === "Escape" || event.key === "Backspace" || event.key === "Delete") &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey
    ) {
      shortcuts.value[action].shortcut = "";
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (shortcut !== null) shortcuts.value[action].shortcut = shortcut;
  }
  return { selectedShortcutAction, shortcutLabels, resetShortcuts, resetShortcut, recordShortcut };
}

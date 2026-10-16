import type { ShortcutSettings } from "@/features/settings/types";
import {
  SHORTCUT_DEFINITIONS,
  cloneShortcuts,
  SHORTCUT_ACTIONS,
  shortcutFromEvent,
} from "@/features/shortcuts/bindings";
import type { ShortcutAction, ShortcutKeyEvent } from "@/features/shortcuts/bindings";

type ShortcutEvent = ShortcutKeyEvent &
  Pick<
    KeyboardEvent,
    "defaultPrevented" | "repeat" | "preventDefault" | "stopImmediatePropagation"
  >;
type ShortcutRuntimeOptions = {
  getSettings: () => Promise<{ shortcuts: ShortcutSettings }>;
  run: (action: ShortcutAction) => Promise<void>;
  onError: (reason: unknown) => void;
  onChange?: (settings: ShortcutSettings) => void;
};

export function createShortcutRuntime(options: ShortcutRuntimeOptions) {
  let shortcuts = cloneShortcuts({});
  let requestSequence = 0;
  let disposed = false;
  const pending = new Set<ShortcutAction>();

  async function refresh() {
    const request = ++requestSequence;
    try {
      const settings = await options.getSettings();
      if (!disposed && request === requestSequence) {
        shortcuts = cloneShortcuts(settings.shortcuts);
        options.onChange?.(cloneShortcuts(shortcuts));
      }
    } catch (reason) {
      if (!disposed && request === requestSequence) options.onError(reason);
    }
  }

  function handleKeydown(event: ShortcutEvent, blocked = false) {
    if (disposed || blocked || event.defaultPrevented) return;
    const binding = shortcutFromEvent(event);
    if (!binding) return;
    const action = SHORTCUT_ACTIONS.find(
      (candidate) => !shortcuts[candidate].global && shortcuts[candidate].shortcut === binding,
    );
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if ((event.repeat && !SHORTCUT_DEFINITIONS[action].repeat) || pending.has(action)) return;
    pending.add(action);
    void Promise.resolve()
      .then(() => options.run(action))
      .catch((reason: unknown) => {
        if (!disposed) options.onError(reason);
      })
      .finally(() => pending.delete(action));
  }

  function dispose() {
    disposed = true;
    requestSequence++;
    shortcuts = cloneShortcuts({});
  }

  return { refresh, handleKeydown, dispose };
}

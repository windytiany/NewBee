import type { ShortcutSettings } from "@/features/settings/types";
import {
  DEFAULT_SHORTCUTS,
  cloneShortcuts,
  SHORTCUT_ACTIONS,
  shortcutFromEvent,
} from "@/features/settings/shortcuts/bindings";
import type { ShortcutAction, ShortcutKeyEvent } from "@/features/settings/shortcuts/bindings";

type ShortcutEvent = ShortcutKeyEvent &
  Pick<
    KeyboardEvent,
    "defaultPrevented" | "repeat" | "preventDefault" | "stopImmediatePropagation"
  >;
type ShortcutRuntimeOptions = {
  getSettings: () => Promise<{ shortcuts: ShortcutSettings }>;
  run: (action: ShortcutAction) => Promise<void>;
  onError: (reason: unknown) => void;
};

export function createShortcutRuntime(options: ShortcutRuntimeOptions) {
  let shortcuts = DEFAULT_SHORTCUTS;
  let requestSequence = 0;
  let disposed = false;
  const pending = new Set<ShortcutAction>();

  async function refresh() {
    const request = ++requestSequence;
    try {
      const settings = await options.getSettings();
      if (!disposed && request === requestSequence) shortcuts = cloneShortcuts(settings.shortcuts);
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
    if (event.repeat || pending.has(action)) return;
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
    shortcuts = DEFAULT_SHORTCUTS;
  }

  return { refresh, handleKeydown, dispose };
}

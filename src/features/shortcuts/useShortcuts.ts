import { onMounted, onUnmounted, shallowRef } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { createSettingsApi } from "@/features/settings/api";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import { createShortcutRuntime } from "@/features/shortcuts/runtime";
import { SHORTCUT_PAGES, isPageShortcut, cloneShortcuts } from "@/features/shortcuts/bindings";
import type { ShortcutAction } from "@/features/shortcuts/bindings";
import type { ContextCommands } from "@/features/shortcuts/context";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

export function useShortcuts(
  navigate: (page: (typeof SHORTCUT_PAGES)[keyof typeof SHORTCUT_PAGES]) => void,
  localCommands: ContextCommands = {},
) {
  const bindings = shallowRef(cloneShortcuts({}));
  async function run(action: ShortcutAction, context: ContextCommands = {}) {
    if (isPageShortcut(action)) {
      navigate(SHORTCUT_PAGES[action]);
      return;
    }
    const local = context[action] ?? localCommands[action];
    if (local) {
      await local();
      return;
    }
    if (action !== "addToQueue") await invoke<void>("run_shortcut", { action });
  }
  if (!isTauri()) return { bindings, run };
  const api = createSettingsApi();
  let disposed = false;
  let unlistenErrors: UnlistenFn | null = null;
  function reportShortcutError(reason: string) {
    if (disposed) return;
    logger.error("shortcuts", "shortcut_failed", reason);
    notify({
      type: "error",
      message: t("快捷键操作失败：{error}", { error: reason }),
      key: "shortcut-error",
    });
  }
  async function monitorRegistrationErrors() {
    try {
      const unlisten = await listen<string>("shortcuts-error", (event) =>
        reportShortcutError(event.payload),
      );
      if (disposed) {
        unlisten();
        return;
      }
      unlistenErrors = unlisten;
      const error = await invoke<string | null>("get_shortcuts_error");
      if (error) reportShortcutError(error);
    } catch (reason) {
      if (!disposed) logger.warn("shortcuts", "Could not monitor shortcut registration.", reason);
    }
  }
  const runtime = createShortcutRuntime({
    getSettings: api.get,
    run,
    onChange: (settings) => {
      bindings.value = settings;
    },
    onError: (reason) => {
      logger.error("shortcuts", "shortcut_failed", reason);
      notify({ type: "error", message: t("快捷键操作失败"), key: "shortcut-error" });
    },
  });

  function handleKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
    const target = event.target;
    const editing =
      target instanceof globalThis.Element &&
      Boolean(
        target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"),
      );
    const nativeSpace =
      event.code === "Space" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      target instanceof globalThis.Element &&
      Boolean(target.closest('button, a, [role="button"]'));
    const listNavigation =
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      target instanceof globalThis.Element &&
      Boolean(target.closest("[data-keyboard-list]")) &&
      (["ArrowUp", "ArrowDown", "Home", "End", "Space", "KeyA"].includes(event.code) ||
        (["ArrowLeft", "ArrowRight"].includes(event.code) &&
          Boolean(target.closest("[data-keyboard-grid]"))));
    runtime.handleKeydown(
      event,
      editing ||
        nativeSpace ||
        listNavigation ||
        Boolean(globalThis.document.querySelector('dialog[open], [role="menu"]')),
    );
  }

  function refresh() {
    void runtime.refresh();
  }
  onMounted(() => {
    globalThis.window.addEventListener("keydown", handleKeydown, true);
    globalThis.window.addEventListener(SETTINGS_CHANGED_EVENT, refresh);
    refresh();
    void monitorRegistrationErrors();
  });
  onUnmounted(() => {
    disposed = true;
    unlistenErrors?.();
    globalThis.window.removeEventListener("keydown", handleKeydown, true);
    globalThis.window.removeEventListener(SETTINGS_CHANGED_EVENT, refresh);
    runtime.dispose();
  });
  return { bindings, run };
}

import { onMounted, onUnmounted } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { createSettingsApi } from "@/features/settings/api";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import { createShortcutRuntime } from "@/features/settings/shortcuts/runtime";
import { SHORTCUT_PAGES, isPageShortcut } from "@/features/settings/shortcuts/bindings";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

export function useShortcuts(
  navigate: (page: (typeof SHORTCUT_PAGES)[keyof typeof SHORTCUT_PAGES]) => void,
) {
  if (!isTauri()) return;
  const api = createSettingsApi();
  let disposed = false;
  let unlistenErrors: UnlistenFn | null = null;
  function reportShortcutError(reason: string) {
    if (disposed) return;
    logger.error("settings/shortcuts", "shortcut_failed", reason);
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
      if (!disposed)
        logger.warn("settings/shortcuts", "Could not monitor shortcut registration.", reason);
    }
  }
  const runtime = createShortcutRuntime({
    getSettings: api.get,
    run: async (action) => {
      if (isPageShortcut(action)) {
        navigate(SHORTCUT_PAGES[action]);
        return;
      }
      await invoke<void>("run_shortcut", { action });
    },
    onError: (reason) => {
      logger.error("settings/shortcuts", "shortcut_failed", reason);
      notify({ type: "error", message: t("快捷键操作失败，请查看日志"), key: "shortcut-error" });
    },
  });

  function handleKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
    const target = event.target;
    const editing =
      target instanceof globalThis.Element &&
      Boolean(
        target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"),
      );
    runtime.handleKeydown(
      event,
      editing || Boolean(globalThis.document.querySelector("dialog[open]")),
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
}

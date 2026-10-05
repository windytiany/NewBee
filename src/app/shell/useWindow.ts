import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMounted, onUnmounted, ref } from "vue";

export function useWindow() {
  const isTauriApp = isTauri();
  const appWindow = isTauriApp ? getCurrentWindow() : null;
  const isMaximized = ref(false);
  let unlistenResize: (() => void) | undefined;

  async function performWindowAction(action: () => Promise<void>, description: string) {
    try {
      await action();
    } catch (error) {
      globalThis.console.error(`Failed to ${description} the window.`, error);
    }
  }

  async function syncMaximizedState() {
    if (!appWindow) return;

    try {
      isMaximized.value = await appWindow.isMaximized();
    } catch (error) {
      globalThis.console.error("Failed to read the window maximized state.", error);
    }
  }

  function startDragging(event: InstanceType<typeof globalThis.MouseEvent>) {
    if (
      !appWindow ||
      (event.target instanceof globalThis.Element && event.target.closest("button, nav"))
    ) {
      return;
    }

    void performWindowAction(() => appWindow.startDragging(), "start dragging");
  }

  async function minimizeWindow() {
    if (!appWindow) return;
    await performWindowAction(() => appWindow.minimize(), "minimize");
  }

  async function toggleMaximizeWindow() {
    if (!appWindow) return;

    await performWindowAction(() => appWindow.toggleMaximize(), "toggle maximize");
    await syncMaximizedState();
  }

  async function closeWindow() {
    if (!appWindow) return;
    await performWindowAction(() => appWindow.close(), "close");
  }

  onMounted(async () => {
    if (!appWindow) return;

    await syncMaximizedState();

    try {
      unlistenResize = await appWindow.onResized(() => {
        void syncMaximizedState();
      });
    } catch (error) {
      globalThis.console.error("Failed to listen for window resize events.", error);
    }
  });

  onUnmounted(() => {
    unlistenResize?.();
  });

  return {
    isTauriApp,
    isMaximized,
    startDragging,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
  };
}

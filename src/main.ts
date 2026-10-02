import { invoke, isTauri } from "@tauri-apps/api/core";
import { createApp, nextTick } from "vue";
import App from "@/App.vue";
import "@/style.css";

globalThis.document.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  { capture: true },
);

createApp(App).mount("#app");

async function showMainWindow() {
  if (!isTauri()) return;

  try {
    await nextTick();
    // nextTick flushes DOM updates; the second frame runs after the first paint.
    await new Promise<void>((resolve) => {
      globalThis.requestAnimationFrame(() => {
        globalThis.requestAnimationFrame(() => resolve());
      });
    });
    await invoke("show_main_window");
  } catch (error) {
    globalThis.console.error("Could not show the main window after startup.", error);
  }
}

void showMainWindow();

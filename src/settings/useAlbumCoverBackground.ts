import { invoke, isTauri } from "@tauri-apps/api/core";
import { onMounted, onScopeDispose, readonly, ref } from "vue";
import { SETTINGS_CHANGED_EVENT, type Settings } from "@/settings/types";

/** Restores the saved preference and refreshes it only after a successful settings save. */
export function useAlbumCoverBackground() {
  const enabled = ref(false);
  let requestSequence = 0;

  async function restore() {
    const sequence = ++requestSequence;
    try {
      const settings = await invoke<Settings>("get_settings");
      if (sequence === requestSequence) enabled.value = settings.albumCoverBackground;
    } catch (error) {
      if (sequence === requestSequence) {
        globalThis.console.error("Could not restore the album cover background setting.", error);
      }
    }
  }

  onMounted(() => {
    if (!isTauri()) return;
    globalThis.window.addEventListener(SETTINGS_CHANGED_EVENT, restore);
    void restore();
  });
  onScopeDispose(() => {
    ++requestSequence;
    globalThis.window.removeEventListener(SETTINGS_CHANGED_EVENT, restore);
  });

  return readonly(enabled);
}

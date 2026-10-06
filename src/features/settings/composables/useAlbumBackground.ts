import { logger } from "@/shared/logging/logger";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createSettingsApi } from "@/features/settings/api";
import { onMounted, onScopeDispose, readonly, ref } from "vue";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";

/** Restores the saved preference and refreshes it only after a successful settings save. */
export function useAlbumBackground() {
  const enabled = ref(false);
  const api = createSettingsApi(invoke);
  let requestSequence = 0;

  async function restore() {
    const sequence = ++requestSequence;
    try {
      const settings = await api.get();
      if (sequence === requestSequence) enabled.value = settings.albumCoverBackground;
    } catch (error) {
      if (sequence === requestSequence) {
        logger.warn(
          "features/settings/composables/useAlbumBackground",
          "Could not restore the album cover background setting.",
          error,
        );
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

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import type { AlbumSummary } from "@/features/library/types";
import { TRACKS_CHANGED_EVENT } from "@/features/tracks/events";
import { createSettingsApi } from "@/features/settings/api";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";

export type TrackPlayStatistics = {
  trackId: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  playCount: number;
};

export function useStatistics(getAlbums: () => readonly AlbumSummary[]) {
  const visible = ref(true);
  const tracks = ref<TrackPlayStatistics[]>([]);
  const isLoading = ref(false);
  const loadFailed = ref(false);
  const scope = computed(() =>
    JSON.stringify(getAlbums().map(({ albumArtist, album }) => [albumArtist, album])),
  );
  const unlisteners: Array<() => void> = [];
  let disposed = false;
  let requestVersion = 0;
  let settingsVersion = 0;

  async function refresh() {
    const version = ++requestVersion;
    if (disposed || !visible.value || !isTauri() || !getAlbums().length) {
      isLoading.value = false;
      return;
    }
    isLoading.value = true;
    try {
      const result = await invoke<TrackPlayStatistics[]>("list_playback_statistics");
      if (disposed || version !== requestVersion) return;
      const albums = new Set(
        getAlbums().map(({ albumArtist, album }) => JSON.stringify([albumArtist, album])),
      );
      tracks.value = result
        .filter(
          (track) =>
            track.playCount > 0 && albums.has(JSON.stringify([track.albumArtist, track.album])),
        )
        .slice(0, 10);
      loadFailed.value = false;
    } catch (cause) {
      if (disposed || version !== requestVersion) return;
      logger.error("library-statistics", "read_failed", cause);
      loadFailed.value = true;
      notify({ type: "error", message: t("读取播放统计失败"), key: "library-statistics" });
    } finally {
      if (!disposed && version === requestVersion) isLoading.value = false;
    }
  }

  async function restoreVisibility() {
    const version = ++settingsVersion;
    try {
      const settings = await createSettingsApi(invoke).get();
      if (disposed || version !== settingsVersion) return;
      visible.value = settings.showPlaybackStatistics;
      await refresh();
    } catch (cause) {
      if (disposed || version !== settingsVersion) return;
      logger.warn("library-statistics", "settings_read_failed", cause);
      await refresh();
    }
  }

  async function subscribe(event: string, receive: () => void) {
    try {
      const stop = await listen(event, receive);
      if (disposed) stop();
      else unlisteners.push(stop);
    } catch (cause) {
      if (disposed) return;
      logger.error("library-statistics", "subscription_failed", cause);
      notify({ type: "error", message: t("播放统计订阅失败"), key: "library-statistics" });
    }
  }

  watch(scope, () => {
    tracks.value = [];
    loadFailed.value = false;
    void refresh();
  });

  onMounted(async () => {
    if (!isTauri()) return;
    globalThis.window.addEventListener(SETTINGS_CHANGED_EVENT, restoreVisibility);
    globalThis.window.addEventListener(LIBRARY_CHANGED_EVENT, refresh);
    globalThis.window.addEventListener(TRACKS_CHANGED_EVENT, refresh);
    await Promise.all([
      subscribe("playback-statistics-changed", () => void refresh()),
      subscribe("playback-statistics-save-failed", () => {
        notify({ type: "error", message: t("保存播放统计失败"), key: "library-statistics" });
      }),
    ]);
    if (!disposed) await restoreVisibility();
  });

  onUnmounted(() => {
    disposed = true;
    ++requestVersion;
    ++settingsVersion;
    globalThis.window?.removeEventListener(SETTINGS_CHANGED_EVENT, restoreVisibility);
    globalThis.window?.removeEventListener(LIBRARY_CHANGED_EVENT, refresh);
    globalThis.window?.removeEventListener(TRACKS_CHANGED_EVENT, refresh);
    for (const stop of unlisteners) stop();
  });

  return { tracks, visible, isLoading, loadFailed };
}

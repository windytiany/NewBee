import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { onUnmounted, ref } from "vue";
import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";

export type TrackPlayStatistics = {
  trackId: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  playCount: number;
};

export function usePlaybackStatistics() {
  const tracks = ref<TrackPlayStatistics[]>([]);
  const isOpen = ref(false);
  const isLoading = ref(false);
  const loadFailed = ref(false);
  const unlisteners: Array<() => void> = [];
  let disposed = false;
  let requestVersion = 0;

  async function refresh() {
    if (disposed || !isOpen.value || !isTauri()) return;
    const version = ++requestVersion;
    isLoading.value = true;
    try {
      const result = await invoke<TrackPlayStatistics[]>("list_playback_statistics");
      if (disposed || version !== requestVersion) return;
      tracks.value = result;
      loadFailed.value = false;
    } catch (cause) {
      if (disposed || version !== requestVersion) return;
      logger.error("playback-statistics", "read_failed", cause);
      loadFailed.value = true;
      notify({ type: "error", message: t("读取播放统计失败"), key: "playback-statistics" });
    } finally {
      if (!disposed && version === requestVersion) isLoading.value = false;
    }
  }

  async function subscribe(event: string, receive: () => void) {
    try {
      const stop = await listen(event, receive);
      if (disposed) stop();
      else unlisteners.push(stop);
    } catch (cause) {
      if (disposed) return;
      logger.error("playback-statistics", "subscription_failed", cause);
      notify({ type: "error", message: t("播放统计订阅失败"), key: "playback-statistics" });
    }
  }

  const ready = isTauri()
    ? Promise.all([
        subscribe("playback-statistics-changed", () => void refresh()),
        subscribe("playback-statistics-save-failed", () => {
          notify({ type: "error", message: t("保存播放统计失败"), key: "playback-statistics" });
        }),
      ])
    : Promise.resolve();

  async function open() {
    isOpen.value = true;
    isLoading.value = isTauri();
    await ready;
    await refresh();
  }

  function close() {
    isOpen.value = false;
    requestVersion += 1;
    isLoading.value = false;
  }

  onUnmounted(() => {
    disposed = true;
    requestVersion += 1;
    for (const stop of unlisteners) stop();
  });

  return { tracks, isOpen, isLoading, loadFailed: loadFailed, open, close };
}

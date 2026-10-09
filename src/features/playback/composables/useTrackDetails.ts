import { invoke } from "@tauri-apps/api/core";
import { onScopeDispose, readonly, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import type { TrackDetails } from "@/features/library/types";
import { logger } from "@/shared/logging/logger";
import { notifications, notify } from "@/shared/notifications/center";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";

export type TrackDetailsInvoker = <Result>(
  command: "get_track",
  args: { trackId: number },
) => Promise<Result>;

export function useTrackDetails(
  trackIdSource: MaybeRefOrGetter<number | null>,
  invokeCommand: TrackDetailsInvoker = invoke,
): {
  currentTrackDetails: Readonly<Ref<TrackDetails | null>>;
  isLoading: Readonly<Ref<boolean>>;
  currentTrackDetailsError: Readonly<Ref<string>>;
  retry: () => void;
} {
  const currentTrackDetails = ref<TrackDetails | null>(null);
  const isLoading = ref(false);
  const currentTrackDetailsError = ref("");
  let currentTrackId: number | null = null;
  let detailsRequestGeneration = 0;

  function syncCurrentTrackInfo(trackId: number | null) {
    currentTrackId = trackId;
    ++detailsRequestGeneration;
    currentTrackDetails.value = null;
    isLoading.value = trackId !== null;
    currentTrackDetailsError.value = "";

    if (trackId === null) return;
    void loadCurrentTrackDetails(trackId);
  }

  function reportError(trackId: number, message: string, reason: unknown = message) {
    currentTrackDetailsError.value = message;
    logger.warn("playback", "details_read_failed", reason, { trackId });
    const key = `playback-details:${trackId}`;
    if (!notifications.items.value.some((item) => item.key === key)) {
      notify({ type: "warning", message, key });
    }
  }

  async function loadCurrentTrackDetails(trackId: number) {
    const generation = ++detailsRequestGeneration;
    isLoading.value = true;
    currentTrackDetailsError.value = "";

    try {
      const result = await invokeCommand<TrackDetails | null>("get_track", { trackId });
      if (generation !== detailsRequestGeneration || currentTrackId !== trackId) return;

      if (!result) {
        reportError(trackId, "未找到正在播放曲目的详情。");
        return;
      }
      if (result.id !== trackId) {
        reportError(trackId, "返回的曲目详情与当前播放曲目不匹配。");
        return;
      }

      currentTrackDetails.value = result;
    } catch (error) {
      if (generation !== detailsRequestGeneration || currentTrackId !== trackId) return;
      reportError(trackId, "读取曲目详情失败", error);
    } finally {
      if (generation === detailsRequestGeneration && currentTrackId === trackId) {
        isLoading.value = false;
      }
    }
  }

  const stopWatching = watch(() => toValue(trackIdSource), syncCurrentTrackInfo, {
    immediate: true,
    flush: "sync",
  });

  function reloadCurrentTrack() {
    if (currentTrackId !== null) void loadCurrentTrackDetails(currentTrackId);
  }
  globalThis.window?.addEventListener(LIBRARY_CHANGED_EVENT, reloadCurrentTrack);

  onScopeDispose(() => {
    globalThis.window?.removeEventListener(LIBRARY_CHANGED_EVENT, reloadCurrentTrack);
    currentTrackId = null;
    ++detailsRequestGeneration;
    stopWatching();
  });

  return {
    retry: reloadCurrentTrack,
    currentTrackDetails: readonly(currentTrackDetails),
    isLoading: readonly(isLoading),
    currentTrackDetailsError: readonly(currentTrackDetailsError),
  };
}

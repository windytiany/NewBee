import { invoke } from "@tauri-apps/api/core";
import { onScopeDispose, readonly, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import type { TrackArtwork, TrackDetails } from "@/types/track";

export type TrackInfoInvoker = <Result>(
  command: "get_track" | "get_track_artwork",
  args: { trackId: number },
) => Promise<Result>;

export function useTrackInfo(
  trackIdSource: MaybeRefOrGetter<number | null>,
  invokeCommand: TrackInfoInvoker = invoke,
): {
  currentTrackDetails: Readonly<Ref<TrackDetails | null>>;
  currentTrackArtworkUrl: Readonly<Ref<string | null>>;
  isLoading: Readonly<Ref<boolean>>;
  currentTrackDetailsError: Readonly<Ref<string>>;
  currentTrackArtworkError: Readonly<Ref<string>>;
} {
  const currentTrackDetails = ref<TrackDetails | null>(null);
  const currentTrackArtworkUrl = ref<string | null>(null);
  const isLoading = ref(false);
  const currentTrackDetailsError = ref("");
  const currentTrackArtworkError = ref("");
  let currentTrackId: number | null = null;
  let detailsRequestGeneration = 0;
  let artworkRequestGeneration = 0;

  function revokeCurrentTrackArtwork() {
    const artworkUrl = currentTrackArtworkUrl.value;
    if (artworkUrl) globalThis.URL.revokeObjectURL(artworkUrl);
    currentTrackArtworkUrl.value = null;
  }

  function syncCurrentTrackInfo(trackId: number | null) {
    currentTrackId = trackId;
    ++detailsRequestGeneration;
    ++artworkRequestGeneration;
    currentTrackDetails.value = null;
    isLoading.value = trackId !== null;
    currentTrackDetailsError.value = "";
    currentTrackArtworkError.value = "";
    revokeCurrentTrackArtwork();

    if (trackId === null) return;
    void loadCurrentTrackDetails(trackId);
    void loadCurrentTrackArtwork(trackId);
  }

  async function loadCurrentTrackDetails(trackId: number) {
    const generation = ++detailsRequestGeneration;
    isLoading.value = true;
    currentTrackDetailsError.value = "";

    try {
      const result = await invokeCommand<TrackDetails | null>("get_track", { trackId });
      if (generation !== detailsRequestGeneration || currentTrackId !== trackId) return;

      if (!result) {
        currentTrackDetailsError.value = "未找到正在播放曲目的详情。";
        return;
      }
      if (result.id !== trackId) {
        currentTrackDetailsError.value = "返回的曲目详情与当前播放曲目不匹配。";
        return;
      }

      currentTrackDetails.value = result;
    } catch (error) {
      if (generation !== detailsRequestGeneration || currentTrackId !== trackId) return;
      const message = error instanceof Error ? error.message : String(error ?? "未知错误");
      currentTrackDetailsError.value = `读取曲目详情失败：${message}`;
    } finally {
      if (generation === detailsRequestGeneration && currentTrackId === trackId) {
        isLoading.value = false;
      }
    }
  }

  async function loadCurrentTrackArtwork(trackId: number) {
    const generation = ++artworkRequestGeneration;
    currentTrackArtworkError.value = "";

    try {
      const artwork = await invokeCommand<TrackArtwork | null>("get_track_artwork", { trackId });
      if (generation !== artworkRequestGeneration || currentTrackId !== trackId) return;

      if (!artwork || artwork.status !== "available") {
        revokeCurrentTrackArtwork();
        return;
      }

      const imageBlob = new globalThis.Blob([Uint8Array.from(artwork.data)], {
        type: artwork.mimeType,
      });
      currentTrackArtworkUrl.value = globalThis.URL.createObjectURL(imageBlob);
    } catch (error) {
      if (generation !== artworkRequestGeneration || currentTrackId !== trackId) return;
      revokeCurrentTrackArtwork();
      const message = error instanceof Error ? error.message : String(error ?? "未知错误");
      currentTrackArtworkError.value = `读取封面失败，已显示占位图：${message}`;
    }
  }

  const stopWatching = watch(() => toValue(trackIdSource), syncCurrentTrackInfo, {
    immediate: true,
    flush: "sync",
  });

  onScopeDispose(() => {
    currentTrackId = null;
    ++detailsRequestGeneration;
    ++artworkRequestGeneration;
    stopWatching();
    revokeCurrentTrackArtwork();
  });

  return {
    currentTrackDetails: readonly(currentTrackDetails),
    currentTrackArtworkUrl: readonly(currentTrackArtworkUrl),
    isLoading: readonly(isLoading),
    currentTrackDetailsError: readonly(currentTrackDetailsError),
    currentTrackArtworkError: readonly(currentTrackArtworkError),
  };
}

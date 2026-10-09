import { invoke } from "@tauri-apps/api/core";
import { onScopeDispose, readonly, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import type { TrackArtwork } from "@/features/artwork/types";
import { createArtworkResource } from "@/features/artwork/artworkResources";
import type {
  ArtworkResource,
  ArtworkResourceSnapshot,
  DecodedArtwork,
} from "@/features/artwork/artworkResources";
import { logger } from "@/shared/logging/logger";

export type TrackArtworkStatus = "loading" | "ready" | "fallback";

type SharedArtwork = {
  trackId: number;
  resource: ArtworkResource;
  subscriptions: number;
};

const sharedArtworkByKey = new Map<string, SharedArtwork>();
const thumbnailLoads: Array<() => void> = [];
const THUMBNAIL_CONCURRENCY = 2;
let activeThumbnailLoads = 0;

export function useTrackArtwork(
  trackId: MaybeRefOrGetter<number | null>,
  size: MaybeRefOrGetter<number | null> = null,
): {
  status: Readonly<Ref<TrackArtworkStatus>>;
  url: Readonly<Ref<string | null>>;
  content: Readonly<Ref<TrackArtwork | null>>;
  error: Readonly<Ref<string>>;
  /** Pins the current decoded URL without adding a loading subscription. */
  retain(): () => void;
} {
  const status = ref<TrackArtworkStatus>("fallback");
  const url = ref<string | null>(null);
  const content = ref<TrackArtwork | null>(null);
  const error = ref("");
  let image: DecodedArtwork | null = null;
  let unsubscribe: (() => void) | null = null;
  const stop = watch(
    [() => toValue(trackId), () => toValue(size)],
    ([nextTrackId, nextSize]) => {
      unsubscribe?.();
      unsubscribe = null;
      image = null;
      url.value = null;
      content.value = null;
      error.value = "";
      if (nextTrackId === null) {
        status.value = "fallback";
        return;
      }
      status.value = "loading";
      if (nextSize === 0) return;
      unsubscribe = subscribeToTrackArtwork(nextTrackId, nextSize, (snapshot) => {
        image = snapshot.image;
        status.value = snapshot.status;
        url.value = image?.url ?? null;
        content.value = image?.content ?? null;
        error.value = snapshot.error;
      });
    },
    { immediate: true, flush: "sync" },
  );
  onScopeDispose(() => {
    stop();
    unsubscribe?.();
    unsubscribe = null;
    image = null;
  });
  return {
    status: readonly(status),
    url: readonly(url),
    content: readonly(content),
    error: readonly(error),
    retain: () => image?.retain() ?? (() => {}),
  };
}

/** Reloads subscribed artwork, optionally restricted to changed tracks. */
export function invalidateTrackArtworkCache(trackIds?: readonly number[]) {
  const changedIds = trackIds === undefined ? null : new Set(trackIds);
  for (const entry of [...sharedArtworkByKey.values()]) {
    if (changedIds === null || changedIds.has(entry.trackId)) entry.resource.reload();
  }
}

function subscribeToTrackArtwork(
  trackId: number,
  size: number | null,
  subscriber: (snapshot: ArtworkResourceSnapshot) => void,
) {
  const key = `${size === null ? "original" : size}:${trackId}`;
  let entry = sharedArtworkByKey.get(key);
  if (!entry) {
    entry = {
      trackId,
      subscriptions: 0,
      resource: createArtworkResource(
        () => invoke<TrackArtwork>("get_track_artwork", { trackId, size }),
        (error) => {
          const message = error instanceof Error ? error.message : String(error ?? "未知错误");
          logger.warn("artwork", "read_failed", error, { trackId });
          return `读取封面失败，已显示占位图：${message}`;
        },
        (run, isCurrent) => scheduleArtworkLoad(size, run, isCurrent),
      ),
    };
    sharedArtworkByKey.set(key, entry);
  }
  const subscribedEntry = entry;
  subscribedEntry.subscriptions++;
  const unsubscribe = subscribedEntry.resource.subscribe(subscriber);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unsubscribe(false);
    if (--subscribedEntry.subscriptions === 0 && sharedArtworkByKey.get(key) === subscribedEntry)
      sharedArtworkByKey.delete(key);
  };
}

function scheduleArtworkLoad(
  size: number | null,
  run: () => Promise<void>,
  isCurrent: () => boolean,
) {
  if (size === null) {
    if (isCurrent()) void run();
    return;
  }
  thumbnailLoads.push(() => {
    if (!isCurrent()) return;
    activeThumbnailLoads++;
    void run().finally(() => {
      activeThumbnailLoads--;
      drainThumbnailLoads();
    });
  });
  drainThumbnailLoads();
}
function drainThumbnailLoads() {
  while (activeThumbnailLoads < THUMBNAIL_CONCURRENCY && thumbnailLoads.length > 0) {
    thumbnailLoads.shift()?.();
  }
}

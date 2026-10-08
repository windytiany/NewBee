import { invoke } from "@tauri-apps/api/core";
import { nextTick, onScopeDispose, readonly, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import type { TrackArtwork } from "@/features/artwork/types";
import { logger } from "@/shared/logging/logger";

export type TrackArtworkStatus = "loading" | "ready" | "fallback";

type ArtworkSnapshot = {
  status: TrackArtworkStatus;
  url: string | null;
  error: string;
};

type ArtworkSubscriber = (snapshot: ArtworkSnapshot) => void;

type SharedArtwork = {
  key: string;
  size: number | null;
  trackId: number;
  status: TrackArtworkStatus;
  url: string | null;
  error: string;
  pendingUrl: string | null;
  decoder: HTMLImageElement | null;
  generation: number;
  subscribers: Set<ArtworkSubscriber>;
  retiredUrls: Set<string>;
  retainedUrls: Map<string, number>;
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
  error: Readonly<Ref<string>>;
} {
  const status = ref<TrackArtworkStatus>("fallback");
  const url = ref<string | null>(null);
  const error = ref("");
  let currentTrackId: number | null = null;
  let unsubscribe: (() => void) | null = null;

  const stop = watch(
    [() => toValue(trackId), () => toValue(size)],
    ([nextTrackId, nextSize]) => {
      currentTrackId = nextTrackId;
      unsubscribe?.();
      unsubscribe = null;
      url.value = null;
      error.value = "";

      if (nextTrackId === null) {
        status.value = "fallback";
        return;
      }

      status.value = "loading";
      if (nextSize === 0) return;
      unsubscribe = subscribeToTrackArtwork(nextTrackId, nextSize, (snapshot) => {
        if (currentTrackId !== nextTrackId) return;
        status.value = snapshot.status;
        url.value = snapshot.url;
        error.value = snapshot.error;
      });
    },
    { immediate: true, flush: "sync" },
  );

  onScopeDispose(() => {
    currentTrackId = null;
    unsubscribe?.();
    unsubscribe = null;
    stop();
  });

  return { status: readonly(status), url: readonly(url), error: readonly(error) };
}

/** Keeps the decoded URL alive until a displayed artwork's leave transition finishes. */
export function retainTrackArtwork(trackId: number, size: number | null = null): () => void {
  const unsubscribe = subscribeToTrackArtwork(trackId, size, () => {});
  const entry = sharedArtworkByKey.get(`${size === null ? "original" : size}:${trackId}`);
  if (!entry) return unsubscribe;
  const url = entry.url;
  if (url) entry.retainedUrls.set(url, (entry.retainedUrls.get(url) ?? 0) + 1);
  let released = false;

  return () => {
    if (released) return;
    released = true;
    if (url) {
      const remaining = (entry.retainedUrls.get(url) ?? 1) - 1;
      if (remaining > 0) entry.retainedUrls.set(url, remaining);
      else {
        entry.retainedUrls.delete(url);
        revokeRetiredUrl(entry, url);
      }
    }
    unsubscribe();
  };
}

/** Reloads subscribed artwork, optionally restricted to changed tracks. */
export function invalidateTrackArtworkCache(trackIds?: readonly number[]) {
  const changedIds = trackIds === undefined ? null : new Set(trackIds);
  for (const entry of [...sharedArtworkByKey.values()]) {
    if (entry.subscribers.size > 0 && (changedIds === null || changedIds.has(entry.trackId))) {
      startArtworkLoad(entry);
    }
  }
}

function subscribeToTrackArtwork(
  trackId: number,
  size: number | null,
  subscriber: ArtworkSubscriber,
) {
  const key = `${size === null ? "original" : size}:${trackId}`;
  let entry = sharedArtworkByKey.get(key);
  const isNewEntry = entry === undefined;
  if (!entry) {
    entry = {
      key,
      size,
      trackId,
      status: "loading",
      url: null,
      error: "",
      pendingUrl: null,
      decoder: null,
      generation: 0,
      subscribers: new Set(),
      retiredUrls: new Set(),
      retainedUrls: new Map(),
    };
    sharedArtworkByKey.set(key, entry);
  }

  entry.subscribers.add(subscriber);
  if (isNewEntry) {
    startArtworkLoad(entry);
  } else {
    subscriber({ status: entry.status, url: entry.url, error: entry.error });
  }

  return () => {
    if (!entry?.subscribers.delete(subscriber)) return;
    if (entry.subscribers.size === 0) releaseEntry(entry);
  };
}

function startArtworkLoad(entry: SharedArtwork) {
  const generation = ++entry.generation;
  const previousUrls = new Set(
    [entry.url, entry.pendingUrl].filter((url): url is string => url !== null),
  );
  entry.url = null;
  entry.pendingUrl = null;
  detachDecoder(entry);
  entry.status = "loading";
  entry.error = "";

  for (const previousUrl of previousUrls) retireUrl(entry, previousUrl);
  publish(entry);

  if (entry.size === null) {
    if (isCurrent(entry, generation)) void loadArtwork(entry, generation);
    return;
  }
  thumbnailLoads.push(() => {
    if (!isCurrent(entry, generation)) return;
    activeThumbnailLoads++;
    void loadArtwork(entry, generation).finally(() => {
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

async function loadArtwork(entry: SharedArtwork, generation: number) {
  try {
    const artwork = await invoke<TrackArtwork>("get_track_artwork", {
      trackId: entry.trackId,
      size: entry.size,
    });
    if (!isCurrent(entry, generation)) return;

    if (artwork.byteLength === 0) {
      showFallback(entry);
      return;
    }

    const imageBlob = new globalThis.Blob([artwork]);
    const imageUrl = globalThis.URL.createObjectURL(imageBlob);
    entry.pendingUrl = imageUrl;
    const decoder = new globalThis.Image();
    entry.decoder = decoder;
    decoder.src = imageUrl;
    await decoder.decode();

    if (!isCurrent(entry, generation)) return;

    entry.pendingUrl = null;
    entry.url = imageUrl;
    entry.status = "ready";
    publish(entry);
  } catch (error) {
    if (!isCurrent(entry, generation)) return;
    const message = error instanceof Error ? error.message : String(error ?? "未知错误");
    entry.error = `读取封面失败，已显示占位图：${message}`;
    logger.warn("artwork", "read_failed", error, { trackId: entry.trackId });
    showFallback(entry);
  }
}

function showFallback(entry: SharedArtwork) {
  const currentUrls = new Set(
    [entry.url, entry.pendingUrl].filter((url): url is string => url !== null),
  );
  entry.url = null;
  entry.pendingUrl = null;
  detachDecoder(entry);
  for (const currentUrl of currentUrls) globalThis.URL.revokeObjectURL(currentUrl);
  entry.status = "fallback";
  publish(entry);
}

function publish(entry: SharedArtwork) {
  const snapshot = { status: entry.status, url: entry.url, error: entry.error };
  for (const subscriber of [...entry.subscribers]) {
    if (entry.subscribers.has(subscriber)) subscriber(snapshot);
  }
}

function isCurrent(entry: SharedArtwork, generation: number) {
  return (
    sharedArtworkByKey.get(entry.key) === entry &&
    entry.generation === generation &&
    entry.subscribers.size > 0
  );
}

function retireUrl(entry: SharedArtwork, url: string) {
  if (entry.retiredUrls.has(url)) return;
  entry.retiredUrls.add(url);
  void nextTick().then(() => revokeRetiredUrl(entry, url));
}

function revokeRetiredUrl(entry: SharedArtwork, url: string) {
  if (entry.retainedUrls.has(url) || !entry.retiredUrls.delete(url)) return;
  globalThis.URL.revokeObjectURL(url);
}

function detachDecoder(entry: SharedArtwork) {
  const decoder = entry.decoder;
  entry.decoder = null;
  decoder?.removeAttribute("src");
}

function releaseEntry(entry: SharedArtwork) {
  if (sharedArtworkByKey.get(entry.key) === entry) {
    sharedArtworkByKey.delete(entry.key);
  }
  ++entry.generation;
  entry.subscribers.clear();
  detachDecoder(entry);

  const urls = new Set(
    [entry.url, entry.pendingUrl, ...entry.retiredUrls].filter(
      (url): url is string => url !== null,
    ),
  );
  entry.url = null;
  entry.pendingUrl = null;
  entry.retiredUrls.clear();
  entry.retainedUrls.clear();
  for (const url of urls) globalThis.URL.revokeObjectURL(url);
}

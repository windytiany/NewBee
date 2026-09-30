import { invoke } from "@tauri-apps/api/core";
import { nextTick, onScopeDispose, readonly, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter, Ref } from "vue";
import type { TrackArtwork } from "@/types/track";

export type TrackArtworkStatus = "loading" | "ready" | "fallback";

type ArtworkSnapshot = {
  status: TrackArtworkStatus;
  url: string | null;
};

type ArtworkSubscriber = (snapshot: ArtworkSnapshot) => void;

type SharedArtwork = {
  trackId: number;
  status: TrackArtworkStatus;
  url: string | null;
  pendingUrl: string | null;
  decoder: HTMLImageElement | null;
  generation: number;
  subscribers: Set<ArtworkSubscriber>;
  retiredUrls: Set<string>;
};

const sharedArtworkByTrackId = new Map<number, SharedArtwork>();

export function useTrackArtwork(trackId: MaybeRefOrGetter<number | null>): {
  status: Readonly<Ref<TrackArtworkStatus>>;
  url: Readonly<Ref<string | null>>;
} {
  const status = ref<TrackArtworkStatus>("fallback");
  const url = ref<string | null>(null);
  let currentTrackId: number | null = null;
  let unsubscribe: (() => void) | null = null;

  const stop = watch(
    () => toValue(trackId),
    (nextTrackId) => {
      currentTrackId = nextTrackId;
      unsubscribe?.();
      unsubscribe = null;
      url.value = null;

      if (nextTrackId === null) {
        status.value = "fallback";
        return;
      }

      status.value = "loading";
      unsubscribe = subscribeToTrackArtwork(nextTrackId, (snapshot) => {
        if (currentTrackId !== nextTrackId) return;
        status.value = snapshot.status;
        url.value = snapshot.url;
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

  return { status: readonly(status), url: readonly(url) };
}

/** Reloads every currently subscribed artwork, for example after a library scan. */
export function invalidateTrackArtworkCache() {
  for (const entry of [...sharedArtworkByTrackId.values()]) {
    if (entry.subscribers.size > 0) startArtworkLoad(entry);
  }
}

function subscribeToTrackArtwork(trackId: number, subscriber: ArtworkSubscriber) {
  let entry = sharedArtworkByTrackId.get(trackId);
  const isNewEntry = entry === undefined;
  if (!entry) {
    entry = {
      trackId,
      status: "loading",
      url: null,
      pendingUrl: null,
      decoder: null,
      generation: 0,
      subscribers: new Set(),
      retiredUrls: new Set(),
    };
    sharedArtworkByTrackId.set(trackId, entry);
  }

  entry.subscribers.add(subscriber);
  if (isNewEntry) {
    startArtworkLoad(entry);
  } else {
    subscriber({ status: entry.status, url: entry.url });
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

  for (const previousUrl of previousUrls) retireUrl(entry, previousUrl);
  publish(entry);

  if (isCurrent(entry, generation)) void loadArtwork(entry, generation);
}

async function loadArtwork(entry: SharedArtwork, generation: number) {
  try {
    const artwork = await invoke<TrackArtwork | null>("get_track_artwork", {
      trackId: entry.trackId,
    });
    if (!isCurrent(entry, generation)) return;

    if (!artwork || artwork.status !== "available") {
      showFallback(entry);
      return;
    }

    const imageBlob = new globalThis.Blob([Uint8Array.from(artwork.data)], {
      type: artwork.mimeType,
    });
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
  } catch {
    if (!isCurrent(entry, generation)) return;
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
  const snapshot = { status: entry.status, url: entry.url };
  for (const subscriber of [...entry.subscribers]) {
    if (entry.subscribers.has(subscriber)) subscriber(snapshot);
  }
}

function isCurrent(entry: SharedArtwork, generation: number) {
  return (
    sharedArtworkByTrackId.get(entry.trackId) === entry &&
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
  if (!entry.retiredUrls.delete(url)) return;
  globalThis.URL.revokeObjectURL(url);
}

function detachDecoder(entry: SharedArtwork) {
  const decoder = entry.decoder;
  entry.decoder = null;
  decoder?.removeAttribute("src");
}

function releaseEntry(entry: SharedArtwork) {
  if (sharedArtworkByTrackId.get(entry.trackId) === entry) {
    sharedArtworkByTrackId.delete(entry.trackId);
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
  for (const url of urls) globalThis.URL.revokeObjectURL(url);
}

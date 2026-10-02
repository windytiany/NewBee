import { invoke } from "@tauri-apps/api/core";
import { computed, nextTick, onScopeDispose, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import type { TrackArtwork } from "@/artwork/types";
import {
  ALBUM_BACKGROUND_SAMPLE_SIZE,
  createAlbumBackgroundPixels,
} from "@/artwork/albumBackground";
import type { AlbumBackground } from "@/artwork/albumBackground";

export type AlbumArtworkSelection = {
  albumArtist: string | null;
  album: string | null;
};

type ArtworkSnapshot = {
  status: "loading" | "ready" | "fallback";
  url: string | null;
  background: AlbumBackground | null;
  error: string;
};

type SharedArtwork = {
  snapshot: ArtworkSnapshot;
  subscribers: Set<(snapshot: ArtworkSnapshot) => void>;
  backgroundRequested: boolean;
  backgroundAttempted: boolean;
  decoder: HTMLImageElement | null;
  objectUrl: string | null;
};

const fallback: ArtworkSnapshot = {
  status: "fallback",
  url: null,
  background: null,
  error: "",
};
// Only subscribed albums are retained; closing the browser releases its cache.
const sharedArtwork = new Map<string, SharedArtwork>();

export function useAlbumArtwork(
  selection: MaybeRefOrGetter<AlbumArtworkSelection | null>,
  purpose: "cover" | "background" = "cover",
) {
  const snapshot = shallowRef(fallback);
  let unsubscribe: (() => void) | null = null;
  const stop = watch(
    () => {
      const album = toValue(selection);
      return album === null ? null : JSON.stringify([album.albumArtist, album.album]);
    },
    (key) => {
      unsubscribe?.();
      unsubscribe = null;
      snapshot.value = fallback;
      const album = toValue(selection);
      if (key === null || album === null) return;

      let entry = sharedArtwork.get(key);
      const isNew = entry === undefined;
      if (!entry) {
        entry = {
          snapshot: { ...fallback, status: "loading" },
          subscribers: new Set(),
          backgroundRequested: false,
          backgroundAttempted: false,
          decoder: null,
          objectUrl: null,
        };
        sharedArtwork.set(key, entry);
      }
      const subscriber = (value: ArtworkSnapshot) => (snapshot.value = value);
      entry.subscribers.add(subscriber);
      entry.backgroundRequested ||= purpose === "background";
      snapshot.value = entry.snapshot;
      if (isNew) void loadArtwork(key, album, entry);
      else if (purpose === "background") generateBackground(entry);

      const subscribedEntry = entry;
      unsubscribe = () => {
        subscribedEntry.subscribers.delete(subscriber);
        if (subscribedEntry.subscribers.size > 0) return;
        sharedArtwork.delete(key);
        subscribedEntry.decoder?.removeAttribute("src");
        subscribedEntry.decoder = null;
        const url = subscribedEntry.objectUrl;
        subscribedEntry.objectUrl = null;
        // Let rendered consumers drop their image before revoking its URL.
        if (url) void nextTick().then(() => globalThis.URL.revokeObjectURL(url));
      };
    },
    { immediate: true, flush: "sync" },
  );

  onScopeDispose(() => {
    stop();
    unsubscribe?.();
  });

  return {
    status: computed(() => snapshot.value.status),
    url: computed(() => snapshot.value.url),
    background: computed(() => snapshot.value.background),
    error: computed(() => snapshot.value.error),
  };
}

async function loadArtwork(key: string, selection: AlbumArtworkSelection, entry: SharedArtwork) {
  try {
    const artwork = await invoke<TrackArtwork | null>("get_album_artwork", selection);
    if (sharedArtwork.get(key) !== entry) return;
    if (!artwork || artwork.status !== "available") {
      publish(entry, fallback);
      return;
    }
    const blob = new globalThis.Blob([Uint8Array.from(artwork.data)], {
      type: artwork.mimeType,
    });
    const url = globalThis.URL.createObjectURL(blob);
    entry.objectUrl = url;
    const decoder = new globalThis.Image();
    entry.decoder = decoder;
    decoder.src = url;
    await decoder.decode();
    if (sharedArtwork.get(key) !== entry) return;
    publish(entry, { ...fallback, status: "ready", url });
    generateBackground(entry);
  } catch (error) {
    if (sharedArtwork.get(key) !== entry) return;
    const url = entry.objectUrl;
    entry.objectUrl = null;
    entry.decoder?.removeAttribute("src");
    entry.decoder = null;
    if (url) globalThis.URL.revokeObjectURL(url);
    publish(entry, {
      ...fallback,
      error: `读取专辑封面失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function generateBackground(entry: SharedArtwork) {
  if (
    !entry.backgroundRequested ||
    entry.backgroundAttempted ||
    entry.snapshot.status !== "ready" ||
    !entry.decoder
  )
    return;
  entry.backgroundAttempted = true;
  try {
    const size = ALBUM_BACKGROUND_SAMPLE_SIZE;
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D 不可用");
    context.drawImage(entry.decoder, 0, 0, size, size);
    const image = context.getImageData(0, 0, size, size);
    const { pixels, color } = createAlbumBackgroundPixels(image.data, size, size);
    image.data.set(pixels);
    context.putImageData(image, 0, 0);
    publish(entry, {
      ...entry.snapshot,
      background: { imageUrl: canvas.toDataURL("image/png"), color },
    });
  } catch (error) {
    publish(entry, {
      ...entry.snapshot,
      error: `生成专辑背景失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function publish(entry: SharedArtwork, snapshot: ArtworkSnapshot) {
  entry.snapshot = snapshot;
  for (const subscriber of entry.subscribers) subscriber(snapshot);
}

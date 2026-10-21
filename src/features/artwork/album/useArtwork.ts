import { t } from "@/shared/i18n/locale";
import { selectArtworkSize } from "@/features/artwork/size";
import { invoke } from "@tauri-apps/api/core";
import { computed, onScopeDispose, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import type { TrackArtwork } from "@/features/artwork/resources";
import { createArtworkResource } from "@/features/artwork/resources";
import type { ArtworkResource, ArtworkResourceSnapshot } from "@/features/artwork/resources";
import { createArtworkBackground } from "@/features/artwork/background";
import type { AlbumBackground } from "@/features/artwork/background";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";

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
  resource: ArtworkResource;
  snapshot: ArtworkSnapshot;
  subscribers: Set<(snapshot: ArtworkSnapshot) => void>;
  backgroundRequested: boolean;
  backgroundAttempted: boolean;
  unsubscribe: (() => void) | null;
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
  size: MaybeRefOrGetter<number | null> = null,
) {
  const snapshot = shallowRef(fallback);
  let unsubscribe: (() => void) | null = null;
  const stop = watch(
    () => {
      const album = toValue(selection);
      const selectedSize = selectArtworkSize(toValue(size));
      return album === null || selectedSize === 0
        ? null
        : JSON.stringify([album.albumArtist, album.album, selectedSize]);
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
        const selectedAlbum = { ...album };
        const selectedSize = selectArtworkSize(toValue(size));
        entry = {
          resource: createArtworkResource(
            () =>
              invoke<TrackArtwork>("get_album_artwork", { ...selectedAlbum, size: selectedSize }),
            (error) => {
              logger.warn("artwork", "album_read_failed", error);
              notify({
                type: "warning",
                message: t("封面加载失败"),
                key: "artwork-read",
              });
              return `读取专辑封面失败：${error instanceof Error ? error.message : String(error)}`;
            },
          ),
          snapshot: { ...fallback, status: "loading" },
          subscribers: new Set(),
          backgroundRequested: false,
          backgroundAttempted: false,
          unsubscribe: null,
        };
        sharedArtwork.set(key, entry);
      }
      const subscribedEntry = entry;
      const subscriber = (value: ArtworkSnapshot) => (snapshot.value = value);
      entry.subscribers.add(subscriber);
      entry.backgroundRequested ||= purpose === "background";
      snapshot.value = entry.snapshot;
      if (isNew) {
        entry.unsubscribe = entry.resource.subscribe((value) =>
          updateResource(subscribedEntry, value),
        );
      } else if (purpose === "background") generateBackground(entry);
      unsubscribe = () => {
        subscribedEntry.subscribers.delete(subscriber);
        if (subscribedEntry.subscribers.size > 0) return;
        if (sharedArtwork.get(key) === subscribedEntry) sharedArtwork.delete(key);
        subscribedEntry.unsubscribe?.();
        subscribedEntry.unsubscribe = null;
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

/** Reload subscribed covers and backgrounds after embedded artwork changes. */
export function invalidateAlbumArtworkCache() {
  for (const entry of [...sharedArtwork.values()]) entry.resource.reload();
}

function updateResource(entry: SharedArtwork, value: ArtworkResourceSnapshot) {
  if (value.status === "loading") entry.backgroundAttempted = false;
  publish(entry, {
    status: value.status,
    url: value.image?.url ?? null,
    background: null,
    error: value.error,
  });
  generateBackground(entry);
}

function generateBackground(entry: SharedArtwork) {
  const image = entry.resource.snapshot.image;
  if (
    !entry.backgroundRequested ||
    entry.backgroundAttempted ||
    entry.snapshot.status !== "ready" ||
    !image
  )
    return;
  entry.backgroundAttempted = true;
  try {
    publish(entry, {
      ...entry.snapshot,
      background: createArtworkBackground(image.decoder),
    });
  } catch (error) {
    logger.warn("artwork", "background_generation_failed", error);
    notify({
      type: "warning",
      message: t("生成专辑背景失败"),
      key: "artwork-background",
    });
    publish(entry, {
      ...entry.snapshot,
      error: `生成专辑背景失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function publish(entry: SharedArtwork, snapshot: ArtworkSnapshot) {
  entry.snapshot = snapshot;
  for (const subscriber of [...entry.subscribers]) {
    if (entry.subscribers.has(subscriber)) subscriber(snapshot);
  }
}

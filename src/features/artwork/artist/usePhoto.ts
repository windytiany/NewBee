import { onScopeDispose, readonly, ref, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { createArtworkResource } from "@/features/artwork/resources";
import type { ArtworkResource } from "@/features/artwork/resources";
import { findArtistPhoto, readArtistPhoto } from "@/features/artwork/artist/api";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

const photos = new Map<string, { resource: ArtworkResource; subscriptions: number }>();

export function refreshArtistPhoto(artist: string) {
  photos.get(artist)?.resource.reload();
}

export function usePhoto(artist: MaybeRefOrGetter<string | null>) {
  const url = ref<string | null>(null);
  let unsubscribe: (() => void) | null = null;
  const stop = watch(
    () => toValue(artist),
    (name) => {
      unsubscribe?.();
      unsubscribe = null;
      url.value = null;
      if (name === null) return;
      let entry = photos.get(name);
      if (!entry) {
        entry = {
          subscriptions: 0,
          resource: createArtworkResource(
            async () => {
              const photo = await readArtistPhoto(name);
              if (photo.byteLength > 0) return photo;
              try {
                if (await findArtistPhoto(name)) return await readArtistPhoto(name);
              } catch (error) {
                logger.warn("artwork.artist", "lookup_failed", error);
              }
              return photo;
            },
            (error) => {
              logger.warn("artwork.artist", "read_failed", error);
              const message = t("读取演出者照片失败");
              notify({ type: "warning", message, key: "artist-photo-read" });
              return message;
            },
          ),
        };
        photos.set(name, entry);
      }
      const subscribed = entry;
      subscribed.subscriptions++;
      const release = subscribed.resource.subscribe((snapshot) => {
        url.value = snapshot.image?.url ?? null;
      });
      unsubscribe = () => {
        release(false);
        if (--subscribed.subscriptions === 0) photos.delete(name);
      };
    },
    { immediate: true, flush: "sync" },
  );
  onScopeDispose(() => {
    stop();
    unsubscribe?.();
  });
  return { url: readonly(url) };
}

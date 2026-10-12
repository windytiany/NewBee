import { onScopeDispose } from "vue";
import type { MaybeRefOrGetter } from "vue";
import type { TrackArtwork } from "@/features/artwork/types";
import { useTrackArtwork } from "@/features/artwork/useTrackArtwork";
import type { TrackArtworkStatus } from "@/features/artwork/useTrackArtwork";

export type TrackArtworkPresentation = {
  key: number;
  status: TrackArtworkStatus;
  url: string | null;
  error: string;
};

/** Owns displayed artwork until its consumer finishes the leave animation. */
export function useTrackArtworkPresentation(
  trackId: MaybeRefOrGetter<number | string | null>,
  size: MaybeRefOrGetter<number | null> = null,
) {
  const artwork = useTrackArtwork(trackId, size);
  const retained = new Map<number, () => void>();
  let previous: (TrackArtworkPresentation & { content: TrackArtwork | null }) | null = null;
  let nextKey = 0;

  function present(pending: boolean): TrackArtworkPresentation {
    const sameArtwork =
      !pending &&
      previous !== null &&
      previous.status === artwork.status.value &&
      isSameArtwork(previous.content, artwork.content.value);
    const key =
      previous && (previous.status === "loading" || sameArtwork) ? previous.key : ++nextKey;
    if (!pending && !sameArtwork && artwork.url.value) retained.set(key, artwork.retain());
    previous = {
      key,
      status: pending ? "loading" : artwork.status.value,
      url: pending ? null : sameArtwork && previous ? previous.url : artwork.url.value,
      content: pending ? null : artwork.content.value,
      error: artwork.error.value,
    };
    return { key, status: previous.status, url: previous.url, error: previous.error };
  }

  function release(key: number) {
    retained.get(key)?.();
    retained.delete(key);
  }

  onScopeDispose(() => {
    for (const releaseArtwork of retained.values()) releaseArtwork();
    retained.clear();
  });

  return { status: artwork.status, url: artwork.url, error: artwork.error, present, release };
}

function isSameArtwork(left: TrackArtwork | null, right: TrackArtwork | null) {
  if (left === right) return true;
  if (left === null || right === null || left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  return leftBytes.every((value, index) => value === rightBytes[index]);
}

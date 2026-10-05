import { computed, readonly, ref, shallowRef } from "vue";
import type { PlaybackCommandInvoker } from "@/features/playback/types";

/** One live, persisted preference per library track, shared by every queue occurrence. */
export function createTrackSkipState(invokeCommand: PlaybackCommandInvoker) {
  const skippedIds = shallowRef<ReadonlySet<number>>(new Set());
  const isPending = ref(false);
  let loaded = false;
  let loading: Promise<void> | null = null;

  function load(): Promise<void> {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
      const ids = await invokeCommand<unknown>("list_skipped_track_ids");
      if (!Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        throw new Error("Invalid skipped track preferences.");
      }
      skippedIds.value = new Set(ids as number[]);
      loaded = true;
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function setTracksSkipped(trackIds: readonly number[], skipped: boolean): Promise<boolean> {
    if (isPending.value || trackIds.length === 0) return false;
    const ids = [...new Set(trackIds)];
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error("Invalid track IDs.");
    }
    isPending.value = true;
    try {
      await load();
      await invokeCommand<void>("set_tracks_skipped", { trackIds: ids, skipped });
      const next = new Set(skippedIds.value);
      for (const id of ids) {
        if (skipped) next.add(id);
        else next.delete(id);
      }
      skippedIds.value = next;
      return true;
    } finally {
      isPending.value = false;
    }
  }

  return Object.freeze({
    skippedTrackIds: readonly(computed(() => [...skippedIds.value])),
    isPending: readonly(isPending),
    isSkipped: (trackId: number) => skippedIds.value.has(trackId),
    load,
    setTracksSkipped,
  });
}

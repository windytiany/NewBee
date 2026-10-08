import { ref } from "vue";
import type { createPlaylistApi } from "@/features/playlist/api";

export function usePlaylistCreation(api: ReturnType<typeof createPlaylistApi>) {
  const playlistId = ref<number | null>(null);
  const addedCount = ref(0);
  let remainingTrackIds: number[] | null = null;

  function reset() {
    playlistId.value = null;
    addedCount.value = 0;
    remainingTrackIds = null;
  }

  async function create(name: string, loadTrackIds: () => Promise<readonly number[]>) {
    if (remainingTrackIds === null) remainingTrackIds = [...(await loadTrackIds())];
    if (playlistId.value === null) playlistId.value = await api.create(name);
    while (remainingTrackIds.length > 0) {
      await api.addTrack(remainingTrackIds[0]!, playlistId.value);
      remainingTrackIds.shift();
      addedCount.value++;
    }
    return playlistId.value;
  }

  return { playlistId, addedCount, reset, create };
}

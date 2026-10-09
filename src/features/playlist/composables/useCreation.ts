import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
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
    try {
      if (remainingTrackIds === null) remainingTrackIds = [...(await loadTrackIds())];
      if (playlistId.value === null) playlistId.value = await api.create(name);
      while (remainingTrackIds.length > 0) {
        await api.addTrack(remainingTrackIds[0]!, playlistId.value);
        remainingTrackIds.shift();
        addedCount.value++;
      }
      return playlistId.value;
    } catch (cause) {
      logger.error("playlist", "create_failed", cause);
      notify({
        type: playlistId.value === null ? "error" : "warning",
        message:
          playlistId.value === null
            ? "创建歌单失败，请查看日志"
            : `歌单已创建，已添加 ${addedCount.value} 首，剩余歌曲添加失败，请查看日志`,
        key: "playlist-create",
      });
      throw cause;
    }
  }

  return { playlistId, addedCount, reset, create };
}

import type { createPlaylistApi } from "@/features/playlist/api";
import { reportPlaylistChanged } from "@/features/playlist/events";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";
import { TaskCancelled } from "@/features/tasks/queue";

export function createDirectoryPlaylists(
  api: ReturnType<typeof createPlaylistApi>,
  append: (playlistId: number, paths: readonly string[]) => Promise<void>,
  active: () => boolean = () => true,
) {
  return async (paths: readonly string[]) => {
    const directories = await api.directories(paths);
    for (const directory of directories) {
      if (!active()) break;
      let playlistId: number | null = null;
      try {
        playlistId = await api.create(directory.name);
        await append(playlistId, [directory.path]);
      } catch (error) {
        if (error instanceof TaskCancelled || error === "任务已取消") throw error;
        logger.error("playlist", "directory_create_failed", error);
        notify({
          type: playlistId === null ? "error" : "warning",
          message:
            playlistId === null
              ? t("创建歌单失败")
              : t("歌单已创建，已添加 {count} 首，剩余歌曲添加失败", { count: 0 }),
        });
      } finally {
        if (playlistId !== null) reportPlaylistChanged(playlistId);
      }
    }
  };
}

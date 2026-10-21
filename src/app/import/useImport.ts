import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { watchActivity } from "@/shared/lifecycle/activity";
import { useLibraryFileImport } from "@/features/library/import/useFileImport";
import { useLibrarySynchronization } from "@/features/library/synchronization/useScan";
import { useInboxImport } from "@/features/inbox/useImport";
import type { DropTarget } from "@/app/import/target";
import { createTrackRegistration } from "@/features/tracks/registration";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { createPlaylistApi } from "@/features/playlist/api";
import { createDirectoryPlaylists } from "@/features/playlist/creation/directory";
import { createPlaylistAppend } from "@/features/playlist/tracks/append";
import { usePlaybackSession } from "@/features/playback/session";
import { notify } from "@/shared/notifications/center";
import { logger, operationId } from "@/shared/logging/logger";
import { tasks } from "@/shared/tasks/state";
import { t } from "@/shared/i18n/locale";

export function useImport() {
  const library = useLibraryFileImport();
  const inbox = useInboxImport();
  const { isScanning } = useLibrarySynchronization();
  const session = usePlaybackSession();
  const synchronization = createTrackSynchronization(session, invoke);
  const register = createTrackRegistration(invoke);
  const playlistApi = createPlaylistApi(invoke);
  const appendPlaylist = createPlaylistAppend(playlistApi);
  const importDirectories = createDirectoryPlaylists(playlistApi, (playlistId, paths) =>
    appendLocal(paths, { kind: "playlist", playlistId }),
  );
  const pending = ref(false);
  watchActivity(pending);
  const busy = computed(
    () => pending.value || library.isImporting.value || inbox.pending.value || isScanning.value,
  );

  async function appendLocal(
    paths: readonly string[],
    captured: Extract<DropTarget, { kind: "playlist" }> | { kind: "queue" },
  ) {
    const outcome = await register(
      paths,
      async (tracks) => {
        if (captured.kind === "playlist") {
          return appendPlaylist(
            captured.playlistId,
            tracks.map((track) => track.id),
          );
        } else {
          const applied = await session.addTracksToQueueEnd(
            tracks.map((track) => ({
              trackId: track.id,
              title: track.title,
              album: track.album,
              durationMs: track.durationMs,
            })),
          );
          if (!applied) throw new Error(t("添加到队尾失败"));
        }
      },
      synchronization.refresh,
    );
    const failed = outcome.results.filter((result) => result.status === "failed");
    if (failed.length) {
      logger.error("tracks", "registration_failed", failed);
      notify({ type: "warning", message: t("{count} 个文件登记失败", { count: failed.length }) });
    }
    if (outcome.appendError) {
      logger.error("import", "append_failed", outcome.appendError);
      const appended = outcome.appendResults;
      notify({
        type: "error",
        message: appended
          ? t("曲目已登记，已添加 {count} 首，{failed} 首追加失败", {
              count: appended.results.filter((result) => result.status === "added").length,
              failed: appended.results.filter((result) => result.status === "failed").length,
            })
          : t("曲目已登记，目标追加失败"),
      });
    }
    if (outcome.refreshError) {
      logger.error("tracks", "refresh_failed", outcome.refreshError);
      notify({ type: "warning", message: t("曲目信息刷新失败") });
    }
  }

  async function importPaths(paths: string[], target: DropTarget) {
    if (busy.value) return;
    pending.value = true;
    const taskKey = operationId("local-import");
    if (target.kind !== "Library" && target.kind !== "Inbox")
      tasks.update({ key: taskKey, message: t("导入音频文件"), completed: 0 });
    try {
      if (target.kind === "Library") await library.importPaths(paths);
      else if (target.kind === "Inbox") await inbox.importPaths(paths);
      else if (target.kind === "playlists") await importDirectories(paths);
      else await appendLocal(paths, target);
    } catch (error) {
      logger.error("import", "drop_failed", error);
      notify({ type: "error", message: t("文件处理失败") });
    } finally {
      tasks.finish(taskKey);
      pending.value = false;
    }
  }

  return { busy, importPaths };
}

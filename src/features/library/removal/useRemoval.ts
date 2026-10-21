import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import type { Ref } from "vue";
import type { createLibraryApi } from "@/features/library/api";
import type { usePlaybackSession } from "@/features/playback/session";
import { reportLibraryRemoval } from "@/features/library/events";
import type { LibraryAlbumSelection } from "@/features/library/types";
import type { TrackSummary } from "@/features/tracks/types";
import type { LibraryActionState } from "@/features/library/useActions";

type LibraryTrackRemovalResult =
  | { status: "not-deleted"; message: string }
  | { status: "deleted" }
  | {
      status: "deleted-queue-sync-failed";
      issue: "stop-failed" | "stop-unconfirmed" | "superseded" | "queue-error";
      message: string;
    };

type LibraryRemovalContext = {
  tracks: Ref<TrackSummary[]>;
  isLoadingTracks: Ref<boolean>;
  libraryApi: ReturnType<typeof createLibraryApi>;
  playbackSession: ReturnType<typeof usePlaybackSession>;
  actions: LibraryActionState;
  runTrackAction: (name: string, action: () => Promise<boolean>) => Promise<boolean>;
};

export function useLibraryRemoval(context: LibraryRemovalContext) {
  const { tracks, isLoadingTracks, libraryApi, playbackSession, runTrackAction } = context;
  const {
    isTrackActionPending,
    trackActionError,
    trackActionMessage,
    trackActionMessageType,
    trackActionRemoval,
  } = context.actions;
  const { currentTrack } = playbackSession.state;
  const { clearQueue: clearPlaybackQueue } = playbackSession;

  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === "string" ? error : "未知错误";
  }

  async function removeTrackFromLibrary(trackId: number): Promise<LibraryTrackRemovalResult> {
    if (
      !tracks.value.some((track) => track.id === trackId) ||
      isLoadingTracks.value ||
      isTrackActionPending.value
    ) {
      const message = "从曲库删除失败：曲目不可用或当前有操作正在进行。";
      trackActionError.value = message;
      return { status: "not-deleted", message };
    }

    isTrackActionPending.value = true;
    trackActionError.value = "";
    trackActionMessage.value = "";
    trackActionRemoval.value = null;
    try {
      const result = await deleteLibraryTrack(trackId);
      trackActionRemoval.value = {
        deletedCount: result.status === "not-deleted" ? 0 : 1,
        failedCount: result.status === "not-deleted" ? 1 : 0,
        queueSyncFailed: result.status === "deleted-queue-sync-failed",
      };
      if (result.status !== "not-deleted") reportLibraryRemoval([trackId]);
      return result;
    } finally {
      isTrackActionPending.value = false;
    }
  }

  async function deleteLibraryTrack(trackId: number): Promise<LibraryTrackRemovalResult> {
    let queueResult;
    try {
      queueResult = await libraryApi.removeTrack(trackId);
    } catch (error) {
      logger.error("library", "remove_failed", error, { trackId });
      const message = "从曲库移除失败";
      trackActionError.value = message;
      return { status: "not-deleted", message };
    }

    if (queueResult.status === "removed" || queueResult.status === "not-found") {
      return { status: "deleted" };
    }

    let issue: Extract<LibraryTrackRemovalResult, { status: "deleted-queue-sync-failed" }>["issue"];
    let message: string;
    switch (queueResult.status) {
      case "stop-failed":
        issue = "stop-failed";
        message = `曲库索引已删除，但停止当前播放失败：${queueResult.message}`;
        break;
      case "stop-unconfirmed":
        issue = "stop-unconfirmed";
        message = "曲库索引已删除，但无法确认当前播放已停止，未推进下一首。";
        break;
      case "superseded":
        issue = "superseded";
        message = "曲库索引已删除，但队列清理已被较新的播放操作取代。";
        break;
      case "queue-error":
        issue = "queue-error";
        message = `曲库索引已删除，但播放队列同步失败：${queueResult.message}`;
        break;
      default:
        throw new Error("Unexpected queue removal result.");
    }
    logger.warn("library", "removed_queue_sync_failed", message, { trackId, issue });
    trackActionError.value = message;
    return { status: "deleted-queue-sync-failed", issue, message };
  }

  async function removeAlbumFromLibrary(selection: LibraryAlbumSelection) {
    const deletedTrackIds: number[] = [];
    const failures: string[] = [];
    let failedCount = 0;
    let queueSyncFailed = false;
    const completed = await runTrackAction("从曲库删除专辑", async () => {
      const sourceTracks = await libraryApi.listAlbumTracks(selection);
      const clearsActivePlayback = sourceTracks.some(
        (track) => track.id === currentTrack.value?.trackId,
      );
      if (clearsActivePlayback) {
        let queueResult:
          | Awaited<ReturnType<typeof clearPlaybackQueue>>
          | { status: "queue-error"; message: string };
        try {
          queueResult = await clearPlaybackQueue();
        } catch (error) {
          queueResult = { status: "queue-error", message: errorMessage(error) };
        }
        switch (queueResult.status) {
          case "removed":
          case "not-found":
            break;
          case "stop-failed":
            failures.push(`播放队列（停止当前播放失败：${queueResult.message}）`);
            break;
          case "stop-unconfirmed":
            failures.push("播放队列（无法确认当前播放已停止）");
            break;
          case "superseded":
            failures.push("播放队列（清理已被较新的播放操作取代）");
            break;
          case "queue-error":
            failures.push(`播放队列（同步失败：${queueResult.message}）`);
            break;
          default:
            throw new Error("Unexpected playback queue clear result.");
        }
      }

      queueSyncFailed = failures.length > 0;
      for (const track of sourceTracks) {
        const result = await deleteLibraryTrack(track.id);
        if (result.status !== "not-deleted") deletedTrackIds.push(track.id);
        else failedCount++;
        if (result.status === "deleted-queue-sync-failed") queueSyncFailed = true;
        if (result.status !== "deleted") {
          failures.push(`${track.title ?? `曲目 ${track.id}`}（${result.message}）`);
        }
      }
      reportLibraryRemoval(deletedTrackIds);
      for (const message of failures) logger.warn("library", "album_remove_partial", message);
      trackActionRemoval.value = {
        deletedCount: deletedTrackIds.length,
        failedCount,
        queueSyncFailed,
      };
      trackActionError.value = failures.length
        ? `已从曲库移除 ${deletedTrackIds.length} 首${failedCount ? `，${failedCount} 首移除失败` : ""}${queueSyncFailed ? "，队列同步失败" : ""}`
        : "";
      trackActionMessageType.value = "success";
      trackActionMessage.value = failures.length
        ? t("已从曲库删除 {count} 首曲目。", { count: deletedTrackIds.length })
        : "";
      return true;
    });
    return {
      completed: completed && failures.length === 0,
      deletedCount: deletedTrackIds.length,
      message: trackActionError.value,
    };
  }

  return { removeTrackFromLibrary, removeAlbumFromLibrary };
}

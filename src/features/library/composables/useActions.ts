import { ref } from "vue";
import type { Ref } from "vue";
import type { LibraryInvoker } from "@/features/library/api";
import { createLibraryApi } from "@/features/library/api";
import { createPlaylistApi } from "@/features/playlist/api";
import { usePlaybackSession } from "@/features/playback/session";
import { reportLibraryRemoval } from "@/features/library/events";
import type { LibraryAlbumSelection, TrackSummary } from "@/features/library/types";
import type { PlaybackDisplayTrack } from "@/features/playback/types";

type LibraryTrackRemovalResult =
  | { status: "not-deleted"; message: string }
  | { status: "deleted" }
  | {
      status: "deleted-queue-sync-failed";
      issue: "stop-failed" | "stop-unconfirmed" | "superseded" | "queue-error";
      message: string;
    };

export function useLibraryActions(
  tracks: Ref<TrackSummary[]>,
  isLoadingTracks: Ref<boolean>,
  invokeCommand: LibraryInvoker,
) {
  const libraryApi = createLibraryApi(invokeCommand);
  const playlistApi = createPlaylistApi(invokeCommand);
  const isTrackActionPending = ref(false);
  const trackActionError = ref("");
  const trackActionMessage = ref("");
  const trackActionMessageType = ref<"success" | "warning">("success");
  const playbackSession = usePlaybackSession();
  const { currentTrack, activeQueueRowKey } = playbackSession.state;
  const {
    playTracks,
    addTracksToNext: enqueueTracksToNext,
    addTracksToQueueEnd: enqueueTracksToQueueEnd,
    removeTrackFromQueue,
  } = playbackSession;
  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === "string" ? error : "未知错误";
  }

  async function runTrackAction(name: string, action: () => Promise<boolean>) {
    if (isTrackActionPending.value) return false;

    isTrackActionPending.value = true;
    trackActionError.value = "";
    trackActionMessage.value = "";
    try {
      if (!(await action())) {
        trackActionError.value = `${name}失败：操作未执行。`;
        return false;
      }
      return true;
    } catch (error) {
      trackActionError.value = `${name}失败：${errorMessage(error)}`;
      return false;
    } finally {
      isTrackActionPending.value = false;
    }
  }

  function findLibraryTrack(trackId: number) {
    return tracks.value.find((track) => track.id === trackId);
  }

  function toQueueTrack(track: TrackSummary): Omit<PlaybackDisplayTrack, "rowKey"> {
    return {
      trackId: track.id,
      title: track.title,
      album: track.album,
      durationMs: track.durationMs,
    };
  }

  function toPlaybackDisplayTracks(sourceTracks: readonly TrackSummary[]): PlaybackDisplayTrack[] {
    return sourceTracks.map((track) => ({
      trackId: track.id,
      rowKey: `album-track:${track.id}`,
      title: track.title,
      album: track.album,
      durationMs: track.durationMs,
    }));
  }

  async function playTrackFromLibrary(trackId: number) {
    if (isLoadingTracks.value || !tracks.value.some((track) => track.id === trackId)) return;

    const displayedTracks = toPlaybackDisplayTracks(tracks.value);
    await playTracks(displayedTracks, `album-track:${trackId}`);
  }

  async function playAlbumFromLibrary() {
    if (isLoadingTracks.value || tracks.value.length === 0) return;

    const firstTrack = tracks.value[0];
    if (!firstTrack) return;

    const displayedTracks = toPlaybackDisplayTracks(tracks.value);
    await playTracks(displayedTracks, `album-track:${firstTrack.id}`, false);
  }

  function findLibraryTracks(trackIds: readonly number[]) {
    return trackIds.flatMap((trackId) => {
      const track = findLibraryTrack(trackId);
      return track ? [track] : [];
    });
  }

  function addTracksToNext(trackIds: readonly number[]) {
    const sourceTracks = findLibraryTracks(trackIds);
    if (isLoadingTracks.value || trackIds.length === 0 || sourceTracks.length !== trackIds.length) {
      return Promise.resolve(false);
    }
    return runTrackAction("添加为下一首", () =>
      enqueueTracksToNext(sourceTracks.map(toQueueTrack)),
    );
  }

  function addTracksToQueueEnd(trackIds: readonly number[]) {
    const sourceTracks = findLibraryTracks(trackIds);
    if (isLoadingTracks.value || trackIds.length === 0 || sourceTracks.length !== trackIds.length) {
      return Promise.resolve(false);
    }
    return runTrackAction("添加到队尾", () =>
      enqueueTracksToQueueEnd(sourceTracks.map(toQueueTrack)),
    );
  }

  async function addTracksToPlaylist(trackIds: readonly number[], playlistId: number) {
    const successfulTrackIds: number[] = [];
    const failures: { trackId: number; trackName: string; message: string }[] = [];
    if (trackIds.length === 0) return { successfulTrackIds, failures };
    if (isTrackActionPending.value || isLoadingTracks.value) {
      const unavailableTracks = trackIds.map((trackId) => ({
        trackId,
        trackName: findLibraryTrack(trackId)?.title ?? `曲目 ${trackId}`,
        message: "曲目不可用或当前有操作正在进行",
      }));
      trackActionError.value = `已成功添加 0 首；${unavailableTracks.length} 首未执行：${unavailableTracks
        .map(({ trackName, message }) => `${trackName}（${message}）`)
        .join("、")}`;
      trackActionMessage.value = "";
      return { successfulTrackIds, failures: unavailableTracks };
    }

    isTrackActionPending.value = true;
    trackActionError.value = "";
    trackActionMessage.value = "";
    try {
      return await appendSourceTracksToPlaylist(trackIds, playlistId, tracks.value);
    } finally {
      isTrackActionPending.value = false;
    }
  }

  async function appendSourceTracksToPlaylist(
    trackIds: readonly number[],
    playlistId: number,
    sourceTracks: readonly TrackSummary[],
  ) {
    const successfulTrackIds: number[] = [];
    const failures: { trackId: number; trackName: string; message: string }[] = [];
    for (const trackId of trackIds) {
      const track = sourceTracks.find((entry) => entry.id === trackId);
      if (!track) {
        failures.push({
          trackId,
          trackName: `曲目 ${trackId}`,
          message: "曲目已不可用",
        });
        continue;
      }

      try {
        await playlistApi.addTrack(trackId, playlistId);
        successfulTrackIds.push(trackId);
      } catch (error) {
        failures.push({
          trackId,
          trackName: track.title ?? `曲目 ${trackId}`,
          message: errorMessage(error),
        });
      }
    }

    trackActionMessageType.value = failures.length ? "warning" : "success";
    trackActionMessage.value = failures.length
      ? `已成功添加 ${successfulTrackIds.length} 首；${failures.length} 首失败：${failures
          .map(({ trackName, message }) => `${trackName}（${message}）`)
          .join("、")}`
      : `已成功添加 ${successfulTrackIds.length} 首到播放列表。`;
    return { successfulTrackIds, failures };
  }

  async function removeTrackFromLibrary(trackId: number): Promise<LibraryTrackRemovalResult> {
    if (!findLibraryTrack(trackId) || isLoadingTracks.value || isTrackActionPending.value) {
      const message = "从曲库删除失败：曲目不可用或当前有操作正在进行。";
      trackActionError.value = message;
      return { status: "not-deleted", message };
    }

    isTrackActionPending.value = true;
    trackActionError.value = "";
    trackActionMessage.value = "";
    try {
      const result = await deleteLibraryTrack(trackId);
      if (result.status !== "not-deleted") reportLibraryRemoval([trackId]);
      return result;
    } finally {
      isTrackActionPending.value = false;
    }
  }

  async function deleteLibraryTrack(trackId: number): Promise<LibraryTrackRemovalResult> {
    try {
      await libraryApi.removeTrack(trackId);
    } catch (error) {
      const message = `从曲库删除失败：${errorMessage(error)}`;
      trackActionError.value = message;
      return { status: "not-deleted", message };
    }

    let queueResult:
      Awaited<ReturnType<typeof removeTrackFromQueue>> | { status: "queue-error"; message: string };
    try {
      queueResult = await removeTrackFromQueue(trackId);
    } catch (error) {
      queueResult = { status: "queue-error", message: errorMessage(error) };
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
    trackActionError.value = message;
    return { status: "deleted-queue-sync-failed", issue, message };
  }

  function loadAlbumActionTracks(selection: LibraryAlbumSelection) {
    return libraryApi.listAlbumTracks(selection);
  }

  function addAlbumToNext(selection: LibraryAlbumSelection) {
    return runTrackAction("添加专辑为下一首", async () => {
      const sourceTracks = await loadAlbumActionTracks(selection);
      return sourceTracks.length > 0 && enqueueTracksToNext(sourceTracks.map(toQueueTrack));
    });
  }

  function addAlbumToQueueEnd(selection: LibraryAlbumSelection) {
    return runTrackAction("添加专辑到队尾", async () => {
      const sourceTracks = await loadAlbumActionTracks(selection);
      return sourceTracks.length > 0 && enqueueTracksToQueueEnd(sourceTracks.map(toQueueTrack));
    });
  }

  async function addAlbumToPlaylist(selection: LibraryAlbumSelection, playlistId: number) {
    let successfulTrackIds: number[] = [];
    await runTrackAction("添加专辑到播放列表", async () => {
      const sourceTracks = await loadAlbumActionTracks(selection);
      const result = await appendSourceTracksToPlaylist(
        sourceTracks.map((track) => track.id),
        playlistId,
        sourceTracks,
      );
      successfulTrackIds = result.successfulTrackIds;
      return sourceTracks.length > 0;
    });
    return { successfulTrackIds };
  }

  async function removeAlbumFromLibrary(selection: LibraryAlbumSelection) {
    const deletedTrackIds: number[] = [];
    const failures: string[] = [];
    const completed = await runTrackAction("从曲库删除专辑", async () => {
      const sourceTracks = await loadAlbumActionTracks(selection);
      for (const track of sourceTracks) {
        const result = await deleteLibraryTrack(track.id);
        if (result.status !== "not-deleted") deletedTrackIds.push(track.id);
        if (result.status !== "deleted") {
          failures.push(`${track.title ?? `曲目 ${track.id}`}（${result.message}）`);
        }
      }
      reportLibraryRemoval(deletedTrackIds);
      trackActionError.value = failures.length ? failures.join("、") : "";
      trackActionMessageType.value = "success";
      trackActionMessage.value = failures.length
        ? `已从曲库删除 ${deletedTrackIds.length} 首曲目。`
        : "";
      return true;
    });
    return {
      completed: completed && failures.length === 0,
      deletedCount: deletedTrackIds.length,
      message: trackActionError.value,
    };
  }

  return {
    isTrackActionPending,
    trackActionError,
    trackActionMessage,
    trackActionMessageType,
    currentTrack,
    activeQueueRowKey,
    playTrackFromLibrary,
    playAlbumFromLibrary,
    addTracksToNext,
    addTracksToQueueEnd,
    addTracksToPlaylist,
    removeTrackFromLibrary,
    addAlbumToNext,
    addAlbumToQueueEnd,
    addAlbumToPlaylist,
    removeAlbumFromLibrary,
  };
}

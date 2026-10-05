import { usePlaybackSession } from "@/features/playback/session";
import type { PlaybackDisplayTrack } from "@/features/playback/types";
import type { PlaylistTrackSummary } from "@/features/playlist/types";
import type { PlaylistMutationState } from "@/features/playlist/composables/useActions";

type NewQueueTrack = Omit<PlaybackDisplayTrack, "rowKey">;

export function usePlaylistPlayback(
  context: Pick<
    PlaylistMutationState,
    | "selectedPlaylistId"
    | "playlistTracks"
    | "playlistTracksPlaylistId"
    | "loadedPlaylistTracksId"
    | "isLoadingPlaylistTracks"
    | "beginPlaylistAction"
    | "finishPlaylistAction"
    | "setPlaylistActionError"
    | "getTargetPlaylistTracks"
  >,
) {
  const {
    selectedPlaylistId,
    playlistTracks,
    playlistTracksPlaylistId,
    loadedPlaylistTracksId,
    isLoadingPlaylistTracks,
    beginPlaylistAction,
    finishPlaylistAction,
    setPlaylistActionError,
    getTargetPlaylistTracks,
  } = context;
  const { playTracks, addTracksToNext, addTracksToQueueEnd } = usePlaybackSession();
  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === "string" ? error : "未知错误";
  }

  function toPlaybackDisplayTracks(
    sourceTracks: readonly PlaylistTrackSummary[],
  ): PlaybackDisplayTrack[] {
    return sourceTracks.map((track) => ({
      trackId: track.trackId,
      rowKey: `playlist-item:${track.playlistItemId}`,
      title: track.title,
      album: track.album,
      durationMs: track.durationMs,
    }));
  }

  function toNewQueueTracks(sourceTracks: readonly PlaylistTrackSummary[]): NewQueueTrack[] {
    return sourceTracks.map((track) => ({
      trackId: track.trackId,
      title: track.title,
      album: track.album,
      durationMs: track.durationMs,
    }));
  }

  async function playTrackFromPlaylist(playlistItemId: number) {
    if (
      isLoadingPlaylistTracks.value ||
      playlistTracksPlaylistId.value !== selectedPlaylistId.value ||
      loadedPlaylistTracksId.value !== selectedPlaylistId.value ||
      !playlistTracks.value.some((track) => track.playlistItemId === playlistItemId)
    ) {
      return;
    }

    const displayedTracks = toPlaybackDisplayTracks(playlistTracks.value);
    await playTracks(displayedTracks, `playlist-item:${playlistItemId}`);
  }

  async function playPlaylistFromPage() {
    if (
      isLoadingPlaylistTracks.value ||
      playlistTracksPlaylistId.value !== selectedPlaylistId.value ||
      loadedPlaylistTracksId.value !== selectedPlaylistId.value ||
      playlistTracks.value.length === 0
    ) {
      return;
    }

    const firstTrack = playlistTracks.value[0];
    if (!firstTrack) return;

    const displayedTracks = toPlaybackDisplayTracks(playlistTracks.value);
    await playTracks(displayedTracks, `playlist-item:${firstTrack.playlistItemId}`, false);
  }

  async function enqueuePlaylistItems(
    playlistItemIds: readonly number[],
    actionName: string,
    enqueue: (tracks: readonly NewQueueTrack[]) => Promise<boolean>,
  ) {
    if (playlistItemIds.length === 0) return;

    const playlistId = selectedPlaylistId.value;
    if (playlistId === null) return;

    const context = beginPlaylistAction(playlistId);
    if (!context) return;

    try {
      const targetTracks = getTargetPlaylistTracks(playlistId, playlistItemIds);
      const accepted = await enqueue(toNewQueueTracks(targetTracks));
      if (!accepted) {
        setPlaylistActionError(context, `${actionName}失败：播放队列未接受本次操作。`);
      }
    } catch (error) {
      setPlaylistActionError(context, `${actionName}失败：${errorMessage(error)}`);
    } finally {
      finishPlaylistAction(context);
    }
  }

  function addPlaylistItemsToNext(playlistItemIds: readonly number[]) {
    return enqueuePlaylistItems(playlistItemIds, "添加为下一首", addTracksToNext);
  }

  function addPlaylistItemsToQueueEnd(playlistItemIds: readonly number[]) {
    return enqueuePlaylistItems(playlistItemIds, "添加到队尾", addTracksToQueueEnd);
  }

  return {
    playTrackFromPlaylist,
    playPlaylistFromPage,
    addPlaylistItemsToNext,
    addPlaylistItemsToQueueEnd,
  };
}

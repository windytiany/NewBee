import { usePlaybackSession } from "@/features/playback/session";
import type { PlaybackDisplayTrack } from "@/features/playback/types";
import type { PlaylistTrackSummary } from "@/features/playlist/types";
import type { PlaylistMutationState } from "@/features/playlist/usePlaylistActions";

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

  function displayedPlaylistTracks(orderedPlaylistItemIds: readonly number[]) {
    const playlistId = selectedPlaylistId.value;
    if (
      playlistId === null ||
      isLoadingPlaylistTracks.value ||
      playlistTracksPlaylistId.value !== playlistId ||
      loadedPlaylistTracksId.value !== playlistId
    )
      return [];
    const availableIds = new Set(playlistTracks.value.map((track) => track.playlistItemId));
    if (
      orderedPlaylistItemIds.length !== availableIds.size ||
      new Set(orderedPlaylistItemIds).size !== availableIds.size ||
      orderedPlaylistItemIds.some((id) => !availableIds.has(id))
    )
      return [];
    return getTargetPlaylistTracks(playlistId, orderedPlaylistItemIds);
  }

  async function playTrackFromPlaylist(
    playlistItemId: number,
    orderedPlaylistItemIds: readonly number[],
  ) {
    const tracks = displayedPlaylistTracks(orderedPlaylistItemIds);
    if (!tracks.some((track) => track.playlistItemId === playlistItemId)) return;
    await playTracks(toPlaybackDisplayTracks(tracks), `playlist-item:${playlistItemId}`);
  }

  async function playPlaylistFromPage(orderedPlaylistItemIds: readonly number[]) {
    const tracks = displayedPlaylistTracks(orderedPlaylistItemIds);
    if (tracks.length === 0) return;
    await playTracks(toPlaybackDisplayTracks(tracks), null, false);
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

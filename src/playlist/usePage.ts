import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { Ref } from "vue";
import { invalidateTrackArtworkCache } from "@/artwork/trackArtwork";
import { LIBRARY_SCAN_COMPLETED_EVENT } from "@/library/scan";
import { usePlaybackSession } from "@/playback/session";
import { usePersistentPlaylistSelection } from "@/playlist/selection";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";
import type { Playlist, PlaylistTrackData } from "@/types/playlist";

type NewQueueTrack = Omit<PlaybackDisplayTrack, "rowKey">;
type DeferredPlaylistRefresh = {
  force: boolean;
  selectPlaylistId?: number;
};
type PlaylistActionContext = {
  playlistId: number;
  generation: number;
};

export function usePlaylistPage(active: Readonly<Ref<boolean>>) {
  const {
    availablePlaylists: playlists,
    selectedPlaylistId,
    selectedPlaylist,
    setAvailablePlaylists,
    selectPlaylist: setSelectedPlaylist,
  } = usePersistentPlaylistSelection();
  const playlistTracks = ref<PlaylistTrackData[]>([]);
  const playlistTracksPlaylistId = ref<number | null>(null);
  const loadedPlaylistTracksId = ref<number | null>(null);
  const isLoadingPlaylists = ref(false);
  const isLoadingPlaylistTracks = ref(false);
  const playlistsError = ref("");
  const playlistTracksError = ref("");
  const playlistActionError = ref("");
  const playlistActionMessage = ref("");
  const pendingPlaylistActionIds = ref(new Set<number>());
  const isPlaylistActionPending = computed(
    () =>
      selectedPlaylistId.value !== null &&
      pendingPlaylistActionIds.value.has(selectedPlaylistId.value),
  );
  const coverTrackId = computed(() => {
    const playlist = selectedPlaylist.value;
    if (!playlist) return null;

    if (
      playlistTracksPlaylistId.value === playlist.id &&
      loadedPlaylistTracksId.value === playlist.id
    ) {
      return playlistTracks.value[0]?.trackId ?? null;
    }

    return playlist.coverTrackId;
  });
  const isCoverPending = computed(() => {
    const playlist = selectedPlaylist.value;
    if (!playlist) return false;

    const hasLoadedCurrentTracks =
      playlistTracksPlaylistId.value === playlist.id &&
      loadedPlaylistTracksId.value === playlist.id;
    return playlist.coverTrackId === null && playlist.trackCount > 0 && !hasLoadedCurrentTracks;
  });
  const { playTracks, addTracksToNext, addTracksToQueueEnd } = usePlaybackSession();
  let isMounted = false;
  let isSubscribedToLibraryScan = false;
  let playlistsRequestGeneration = 0;
  let playlistTracksRequestGeneration = 0;
  let playlistContextGeneration = 0;
  let deferredPlaylistRefresh: DeferredPlaylistRefresh | null = null;
  const activePlaylistDataMutations = new Set<number>();

  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === "string" ? error : "未知错误";
  }

  function setPlaylistTracksSource(playlistId: number | null) {
    if (playlistTracksPlaylistId.value === playlistId) return;

    ++playlistTracksRequestGeneration;
    playlistTracksPlaylistId.value = playlistId;
    loadedPlaylistTracksId.value = null;
    playlistTracks.value = [];
    playlistTracksError.value = "";
    isLoadingPlaylistTracks.value = false;
  }

  function isCurrentPlaylistAction(context: PlaylistActionContext) {
    return (
      playlistContextGeneration === context.generation &&
      selectedPlaylistId.value === context.playlistId
    );
  }

  function beginPlaylistAction(playlistId: number): PlaylistActionContext | null {
    if (selectedPlaylistId.value !== playlistId || pendingPlaylistActionIds.value.has(playlistId)) {
      return null;
    }

    const pendingIds = new Set(pendingPlaylistActionIds.value);
    pendingIds.add(playlistId);
    pendingPlaylistActionIds.value = pendingIds;
    playlistActionError.value = "";
    playlistActionMessage.value = "";
    return { playlistId, generation: playlistContextGeneration };
  }

  function finishPlaylistAction(context: PlaylistActionContext) {
    const pendingIds = new Set(pendingPlaylistActionIds.value);
    pendingIds.delete(context.playlistId);
    pendingPlaylistActionIds.value = pendingIds;
  }

  function setPlaylistActionError(context: PlaylistActionContext, message: string) {
    if (!isCurrentPlaylistAction(context)) return;
    playlistActionError.value = message;
    playlistActionMessage.value = "";
  }

  function setPlaylistActionMessage(context: PlaylistActionContext, message: string) {
    if (!isCurrentPlaylistAction(context)) return;
    playlistActionError.value = "";
    playlistActionMessage.value = message;
  }

  function reportPlaylistActionError(playlistId: number, message: string) {
    if (selectedPlaylistId.value !== playlistId) return;
    playlistActionError.value = message;
    playlistActionMessage.value = "";
  }

  function getLoadedPlaylistTracks(playlistId: number) {
    if (
      selectedPlaylistId.value !== playlistId ||
      playlistTracksPlaylistId.value !== playlistId ||
      loadedPlaylistTracksId.value !== playlistId
    ) {
      throw new Error("当前歌单曲目尚未加载完成。");
    }

    return playlistTracks.value;
  }

  function getTargetPlaylistTracks(
    playlistId: number,
    playlistItemIds: readonly number[],
  ): PlaylistTrackData[] {
    const sourceTracks = getLoadedPlaylistTracks(playlistId);
    const availableIds = new Set(sourceTracks.map(({ playlistItemId }) => playlistItemId));
    if (playlistItemIds.some((playlistItemId) => !availableIds.has(playlistItemId))) {
      throw new Error("部分目标条目不属于当前已加载的歌单。");
    }

    const targetIds = new Set(playlistItemIds);
    return sourceTracks.filter(({ playlistItemId }) => targetIds.has(playlistItemId));
  }

  function replacePlaylistSummary(summary: Playlist) {
    if (!playlists.value.some(({ id }) => id === summary.id)) return false;

    setAvailablePlaylists(
      playlists.value.map((playlist) => (playlist.id === summary.id ? summary : playlist)),
    );
    return true;
  }

  function updatePlaylistSummary(
    playlistId: number,
    changes: Partial<Pick<Playlist, "trackCount" | "coverTrackId">>,
  ) {
    const summary = playlists.value.find(({ id }) => id === playlistId);
    if (!summary) return null;

    const updatedSummary = { ...summary, ...changes };
    replacePlaylistSummary(updatedSummary);
    return summary;
  }

  function syncPlaylistSummaryFromTracks(playlistId: number, tracks: readonly PlaylistTrackData[]) {
    updatePlaylistSummary(playlistId, {
      trackCount: tracks.length,
      coverTrackId: tracks[0]?.trackId ?? null,
    });
  }

  function deferPlaylistRefresh(selectPlaylistId?: number, force = false) {
    if (!deferredPlaylistRefresh) {
      deferredPlaylistRefresh =
        selectPlaylistId === undefined ? { force } : { force, selectPlaylistId };
      return;
    }

    deferredPlaylistRefresh.force ||= force;
    if (selectPlaylistId !== undefined) {
      deferredPlaylistRefresh.selectPlaylistId = selectPlaylistId;
    }
  }

  function flushDeferredPlaylistRefresh() {
    if (activePlaylistDataMutations.size > 0 || deferredPlaylistRefresh === null) return;

    const request = deferredPlaylistRefresh;
    deferredPlaylistRefresh = null;
    if (!isMounted || (!request.force && !active.value)) return;
    void refreshPlaylists(request.selectPlaylistId, request.force);
  }

  function beginPlaylistDataMutation(playlistId: number) {
    if (isLoadingPlaylists.value || isLoadingPlaylistTracks.value) {
      deferPlaylistRefresh();
    }

    activePlaylistDataMutations.add(playlistId);
    ++playlistsRequestGeneration;
    ++playlistTracksRequestGeneration;
    isLoadingPlaylists.value = false;
    isLoadingPlaylistTracks.value = false;
  }

  function finishPlaylistDataMutation(playlistId: number) {
    activePlaylistDataMutations.delete(playlistId);
    flushDeferredPlaylistRefresh();
  }

  function isPlaylistTracksRequestCurrent(playlistId: number, generation: number, force: boolean) {
    return (
      isMounted &&
      (force || active.value) &&
      generation === playlistTracksRequestGeneration &&
      selectedPlaylistId.value === playlistId &&
      playlistTracksPlaylistId.value === playlistId
    );
  }

  async function loadPlaylistTracks(playlistId: number, force = false) {
    if (!isMounted || (!force && !active.value) || selectedPlaylistId.value !== playlistId) return;

    setPlaylistTracksSource(playlistId);
    if (activePlaylistDataMutations.size > 0) {
      isLoadingPlaylistTracks.value = true;
      deferPlaylistRefresh(undefined, force);
      return;
    }

    const generation = ++playlistTracksRequestGeneration;
    playlistTracksError.value = "";
    isLoadingPlaylistTracks.value = true;

    try {
      const result = await invoke<PlaylistTrackData[]>("list_playlist_tracks", { playlistId });
      if (!isPlaylistTracksRequestCurrent(playlistId, generation, force)) return;

      playlistTracks.value = result;
      loadedPlaylistTracksId.value = playlistId;
      syncPlaylistSummaryFromTracks(playlistId, result);
    } catch (error) {
      if (!isPlaylistTracksRequestCurrent(playlistId, generation, force)) return;
      playlistTracksError.value = `读取歌单曲目失败：${errorMessage(error)}`;
    } finally {
      if (isPlaylistTracksRequestCurrent(playlistId, generation, force)) {
        isLoadingPlaylistTracks.value = false;
      }
    }
  }

  async function refreshPlaylists(selectPlaylistId?: number, force = false) {
    if (!isMounted || (!force && !active.value)) return;
    if (activePlaylistDataMutations.size > 0) {
      deferPlaylistRefresh(selectPlaylistId, force);
      return;
    }

    const generation = ++playlistsRequestGeneration;
    ++playlistTracksRequestGeneration;
    isLoadingPlaylists.value = true;
    isLoadingPlaylistTracks.value = selectedPlaylistId.value !== null;
    playlistsError.value = "";
    playlistTracksError.value = "";

    try {
      const result = await invoke<Playlist[]>("list_playlists");
      if (!isMounted || (!force && !active.value) || generation !== playlistsRequestGeneration)
        return;

      setAvailablePlaylists(result);
      if (selectPlaylistId !== undefined) {
        const createdPlaylist = result.find(({ id }) => id === selectPlaylistId);
        if (createdPlaylist) setSelectedPlaylist(createdPlaylist);
      }

      const playlistId = selectedPlaylistId.value;
      if (playlistId === null) {
        setPlaylistTracksSource(null);
        isLoadingPlaylistTracks.value = false;
      } else {
        setPlaylistTracksSource(playlistId);
        void loadPlaylistTracks(playlistId, force);
      }
    } catch (error) {
      if (!isMounted || (!force && !active.value) || generation !== playlistsRequestGeneration)
        return;
      playlistsError.value = `读取歌单失败：${errorMessage(error)}`;
      isLoadingPlaylistTracks.value = false;
    } finally {
      if (isMounted && (force || active.value) && generation === playlistsRequestGeneration) {
        isLoadingPlaylists.value = false;
      }
    }
  }

  function selectPlaylist(playlist: Playlist) {
    if (selectedPlaylistId.value === playlist.id) return;

    setSelectedPlaylist(playlist);
    void loadPlaylistTracks(playlist.id);
  }

  function toPlaybackDisplayTracks(
    sourceTracks: readonly PlaylistTrackData[],
  ): PlaybackDisplayTrack[] {
    return sourceTracks.map((track) => ({
      trackId: track.trackId,
      rowKey: `playlist-item:${track.playlistItemId}`,
      title: track.title,
      album: track.album,
      durationMs: track.durationMs,
    }));
  }

  function toNewQueueTracks(sourceTracks: readonly PlaylistTrackData[]): NewQueueTrack[] {
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
    await playTracks(displayedTracks, `playlist-item:${firstTrack.playlistItemId}`);
  }

  async function enqueuePlaylistItems(
    playlistItemIds: readonly number[],
    actionName: string,
    successMessage: (count: number) => string,
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
        return;
      }

      setPlaylistActionMessage(context, successMessage(targetTracks.length));
    } catch (error) {
      setPlaylistActionError(context, `${actionName}失败：${errorMessage(error)}`);
    } finally {
      finishPlaylistAction(context);
    }
  }

  function addPlaylistItemsToNext(playlistItemIds: readonly number[]) {
    return enqueuePlaylistItems(
      playlistItemIds,
      "添加为下一首",
      (count) => `已将 ${count} 个歌单条目添加为下一首。`,
      addTracksToNext,
    );
  }

  function addPlaylistItemsToQueueEnd(playlistItemIds: readonly number[]) {
    return enqueuePlaylistItems(
      playlistItemIds,
      "添加到队尾",
      (count) => `已将 ${count} 个歌单条目添加到队尾。`,
      addTracksToQueueEnd,
    );
  }

  async function removePlaylistItems(playlistItemIds: readonly number[]) {
    const targetIds = [...playlistItemIds];
    if (targetIds.length === 0) return;

    const playlistId = selectedPlaylistId.value;
    if (playlistId === null) return;

    const context = beginPlaylistAction(playlistId);
    if (!context) return;

    let mutationStarted = false;
    try {
      if (new Set(targetIds).size !== targetIds.length) {
        throw new Error("目标歌单条目 ID 不能重复。");
      }
      const sourceTracks = [...getLoadedPlaylistTracks(playlistId)];
      getTargetPlaylistTracks(playlistId, targetIds);
      beginPlaylistDataMutation(playlistId);
      mutationStarted = true;

      await invoke<void>("remove_playlist_items", {
        playlistId,
        playlistItemIds: targetIds,
      });

      const targetIdsSet = new Set(targetIds);
      const remainingTracks = sourceTracks.filter(
        ({ playlistItemId }) => !targetIdsSet.has(playlistItemId),
      );
      if (
        selectedPlaylistId.value === playlistId &&
        playlistTracksPlaylistId.value === playlistId &&
        loadedPlaylistTracksId.value === playlistId
      ) {
        playlistTracks.value = remainingTracks;
      }
      updatePlaylistSummary(playlistId, {
        trackCount: remainingTracks.length,
        coverTrackId: remainingTracks[0]?.trackId ?? null,
      });
      setPlaylistActionMessage(context, `已从歌单移除 ${targetIds.length} 个条目。`);
    } catch (error) {
      setPlaylistActionError(context, `移除歌单条目失败：${errorMessage(error)}`);
    } finally {
      if (mutationStarted) finishPlaylistDataMutation(playlistId);
      finishPlaylistAction(context);
    }
  }

  function isPlaylistItemSetMismatch(error: unknown) {
    return errorMessage(error).includes("Ordered playlist item IDs must exactly match");
  }

  async function reorderPlaylistItems(orderedPlaylistItemIds: readonly number[]) {
    const playlistId = selectedPlaylistId.value;
    if (playlistId === null || pendingPlaylistActionIds.value.has(playlistId)) return;

    const orderedIds = [...orderedPlaylistItemIds];
    let sourceTracks: PlaylistTrackData[];
    try {
      sourceTracks = [...getLoadedPlaylistTracks(playlistId)];
    } catch (error) {
      reportPlaylistActionError(playlistId, `保存歌单排序失败：${errorMessage(error)}`);
      return;
    }

    const sourceIds = new Set(sourceTracks.map(({ playlistItemId }) => playlistItemId));
    const orderedIdsSet = new Set(orderedIds);
    if (
      orderedIds.length !== sourceTracks.length ||
      orderedIdsSet.size !== sourceIds.size ||
      [...orderedIdsSet].some((playlistItemId) => !sourceIds.has(playlistItemId))
    ) {
      reportPlaylistActionError(playlistId, "排序列表与当前已加载歌单条目不一致。");
      return;
    }

    if (
      orderedIds.every(
        (playlistItemId, index) => playlistItemId === sourceTracks[index]?.playlistItemId,
      )
    ) {
      return;
    }

    const originalSummary = playlists.value.find(({ id }) => id === playlistId);
    if (!originalSummary) {
      reportPlaylistActionError(playlistId, "保存歌单排序失败：找不到当前歌单摘要。");
      return;
    }

    const context = beginPlaylistAction(playlistId);
    if (!context) return;

    const originalTracks = sourceTracks;
    const rollbackSummary = { ...originalSummary };
    const tracksById = new Map(originalTracks.map((track) => [track.playlistItemId, track]));
    const reorderedTracks = orderedIds.flatMap((playlistItemId) => {
      const track = tracksById.get(playlistItemId);
      return track ? [track] : [];
    });
    let mutationStarted = false;

    try {
      beginPlaylistDataMutation(playlistId);
      mutationStarted = true;
      if (
        selectedPlaylistId.value === playlistId &&
        playlistTracksPlaylistId.value === playlistId &&
        loadedPlaylistTracksId.value === playlistId
      ) {
        playlistTracks.value = reorderedTracks;
      }
      updatePlaylistSummary(playlistId, {
        trackCount: reorderedTracks.length,
        coverTrackId: reorderedTracks[0]?.trackId ?? null,
      });

      await invoke<void>("reorder_playlist_items", {
        playlistId,
        orderedPlaylistItemIds: orderedIds,
      });
      setPlaylistActionMessage(context, "歌单排序已保存。");
    } catch (error) {
      if (
        selectedPlaylistId.value === playlistId &&
        playlistTracksPlaylistId.value === playlistId &&
        loadedPlaylistTracksId.value === playlistId
      ) {
        playlistTracks.value = originalTracks;
      }
      replacePlaylistSummary(rollbackSummary);
      if (isPlaylistItemSetMismatch(error)) deferPlaylistRefresh();
      setPlaylistActionError(context, `保存歌单排序失败：${errorMessage(error)}`);
    } finally {
      if (mutationStarted) finishPlaylistDataMutation(playlistId);
      finishPlaylistAction(context);
    }
  }

  function onLibraryScanCompleted() {
    invalidateTrackArtworkCache();
    void refreshPlaylists();
  }

  function activate() {
    if (!isMounted || !active.value) return;

    if (!isSubscribedToLibraryScan) {
      globalThis.window.addEventListener(LIBRARY_SCAN_COMPLETED_EVENT, onLibraryScanCompleted);
      isSubscribedToLibraryScan = true;
    }
    void refreshPlaylists();
  }

  function deactivate() {
    if (isSubscribedToLibraryScan) {
      globalThis.window.removeEventListener(LIBRARY_SCAN_COMPLETED_EVENT, onLibraryScanCompleted);
      isSubscribedToLibraryScan = false;
    }

    ++playlistsRequestGeneration;
    ++playlistTracksRequestGeneration;
    isLoadingPlaylists.value = false;
    isLoadingPlaylistTracks.value = false;
  }

  watch(
    selectedPlaylistId,
    (playlistId) => {
      ++playlistContextGeneration;
      playlistActionError.value = "";
      playlistActionMessage.value = "";
      setPlaylistTracksSource(playlistId);
    },
    { flush: "sync" },
  );

  watch(
    active,
    (isActive) => {
      if (!isMounted) return;
      if (isActive) activate();
      else deactivate();
    },
    { flush: "sync" },
  );

  onMounted(() => {
    isMounted = true;
    if (active.value) activate();
  });

  onUnmounted(() => {
    isMounted = false;
    deactivate();
  });

  return {
    playlists,
    selectedPlaylistId,
    selectedPlaylist,
    playlistTracks,
    isLoadingPlaylists,
    isLoadingPlaylistTracks,
    playlistsError,
    playlistTracksError,
    isPlaylistActionPending,
    playlistActionError,
    playlistActionMessage,
    coverTrackId,
    isCoverPending,
    selectPlaylist,
    playTrackFromPlaylist,
    playPlaylistFromPage,
    addPlaylistItemsToNext,
    addPlaylistItemsToQueueEnd,
    removePlaylistItems,
    reorderPlaylistItems,
    refreshPlaylists,
  };
}

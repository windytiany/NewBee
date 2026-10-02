import { invoke } from "@tauri-apps/api/core";
import { computed, readonly, ref, watch } from "vue";
import type { Ref } from "vue";
import { usePlaybackSession } from "@/playback/session";
import { usePersistentPlaylistSelection } from "@/playlist/selection";
import type { PlaybackDisplayTrack } from "@/playback/queue/model";
import type { PlaylistSummary, PlaylistTrackSummary } from "@/playlist/model";

type NewQueueTrack = Omit<PlaybackDisplayTrack, "rowKey">;
type DeferredPlaylistRefresh = {
  force: boolean;
  selectPlaylistId?: number;
};
type PlaylistActionContext = {
  playlistId: number;
  generation: number;
};
type PlaylistManagementResult = { status: "success" } | { status: "error"; message: string };

/** Unavailable before mount and after disposal; background still permits forced refreshes. */
export type PlaylistAvailability = "unavailable" | "active" | "background";

export function usePlaylistState(availability: Readonly<Ref<PlaylistAvailability>>) {
  const {
    availablePlaylists: playlists,
    selectedPlaylistId,
    selectedPlaylist,
    setAvailablePlaylists,
    selectPlaylist: setSelectedPlaylist,
  } = usePersistentPlaylistSelection();
  const playlistTracks = ref<PlaylistTrackSummary[]>([]);
  const playlistTracksPlaylistId = ref<number | null>(null);
  const loadedPlaylistTracksId = ref<number | null>(null);
  const isLoadingPlaylists = ref(false);
  const isLoadingPlaylistTracks = ref(false);
  const playlistsError = ref("");
  const playlistTracksError = ref("");
  const playlistActionError = ref("");
  const pendingPlaylistActionIds = ref(new Set<number>());
  const pendingPlaylistIds = computed<readonly number[]>(() => [...pendingPlaylistActionIds.value]);
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

  function lockPlaylistAction(playlistId: number): PlaylistActionContext | null {
    if (pendingPlaylistActionIds.value.has(playlistId)) return null;

    const pendingIds = new Set(pendingPlaylistActionIds.value);
    pendingIds.add(playlistId);
    pendingPlaylistActionIds.value = pendingIds;
    return { playlistId, generation: playlistContextGeneration };
  }

  function beginPlaylistAction(playlistId: number): PlaylistActionContext | null {
    if (selectedPlaylistId.value !== playlistId) return null;

    const context = lockPlaylistAction(playlistId);
    if (!context) return null;

    playlistActionError.value = "";
    return context;
  }

  function finishPlaylistAction(context: PlaylistActionContext) {
    const pendingIds = new Set(pendingPlaylistActionIds.value);
    pendingIds.delete(context.playlistId);
    pendingPlaylistActionIds.value = pendingIds;
  }

  function setPlaylistActionError(context: PlaylistActionContext, message: string) {
    if (!isCurrentPlaylistAction(context)) return;
    playlistActionError.value = message;
  }

  function reportPlaylistActionError(playlistId: number, message: string) {
    if (selectedPlaylistId.value !== playlistId) return;
    playlistActionError.value = message;
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
  ): PlaylistTrackSummary[] {
    const sourceTracks = getLoadedPlaylistTracks(playlistId);
    const availableIds = new Set(sourceTracks.map(({ playlistItemId }) => playlistItemId));
    if (playlistItemIds.some((playlistItemId) => !availableIds.has(playlistItemId))) {
      throw new Error("部分目标条目不属于当前已加载的歌单。");
    }

    const targetIds = new Set(playlistItemIds);
    return sourceTracks.filter(({ playlistItemId }) => targetIds.has(playlistItemId));
  }

  function replacePlaylistSummary(summary: PlaylistSummary) {
    if (!playlists.value.some(({ id }) => id === summary.id)) return false;

    setAvailablePlaylists(
      playlists.value.map((playlist) => (playlist.id === summary.id ? summary : playlist)),
    );
    return true;
  }

  function updatePlaylistSummary(
    playlistId: number,
    changes: Partial<Pick<PlaylistSummary, "trackCount" | "coverTrackId">>,
  ) {
    const summary = playlists.value.find(({ id }) => id === playlistId);
    if (!summary) return null;

    const updatedSummary = { ...summary, ...changes };
    replacePlaylistSummary(updatedSummary);
    return summary;
  }

  function syncPlaylistSummaryFromTracks(
    playlistId: number,
    tracks: readonly PlaylistTrackSummary[],
  ) {
    updatePlaylistSummary(playlistId, {
      trackCount: tracks.length,
      coverTrackId: tracks[0]?.trackId ?? null,
    });
  }

  function canQuery(force: boolean) {
    return availability.value !== "unavailable" && (force || availability.value === "active");
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
    if (!canQuery(request.force)) return;
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
      canQuery(force) &&
      generation === playlistTracksRequestGeneration &&
      selectedPlaylistId.value === playlistId &&
      playlistTracksPlaylistId.value === playlistId
    );
  }

  async function loadPlaylistTracks(playlistId: number, force = false) {
    if (!canQuery(force) || selectedPlaylistId.value !== playlistId) return;

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
      const result = await invoke<PlaylistTrackSummary[]>("list_playlist_tracks", { playlistId });
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
    if (!canQuery(force)) return;
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
      const result = await invoke<PlaylistSummary[]>("list_playlists");
      if (!canQuery(force) || generation !== playlistsRequestGeneration) return;

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
      if (!canQuery(force) || generation !== playlistsRequestGeneration) return;
      playlistsError.value = `读取歌单失败：${errorMessage(error)}`;
      isLoadingPlaylistTracks.value = false;
    } finally {
      if (canQuery(force) && generation === playlistsRequestGeneration) {
        isLoadingPlaylists.value = false;
      }
    }
  }

  function selectPlaylist(playlist: PlaylistSummary) {
    if (selectedPlaylistId.value === playlist.id) return;

    setSelectedPlaylist(playlist);
    void loadPlaylistTracks(playlist.id);
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
    await playTracks(displayedTracks, `playlist-item:${firstTrack.playlistItemId}`);
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

  async function renamePlaylist(
    playlistId: number,
    name: string,
  ): Promise<PlaylistManagementResult> {
    const normalizedName = name.trim();
    if (!normalizedName) {
      return { status: "error", message: "歌单名称不能为空。" };
    }
    if (!playlists.value.some(({ id }) => id === playlistId)) {
      return { status: "error", message: "目标歌单不存在。" };
    }

    const context = lockPlaylistAction(playlistId);
    if (!context) {
      return { status: "error", message: "该歌单正在处理中，请稍后重试。" };
    }

    let mutationStarted = false;
    try {
      beginPlaylistDataMutation(playlistId);
      mutationStarted = true;
      await invoke<void>("rename_playlist", { playlistId, name: normalizedName });

      const summary = playlists.value.find(({ id }) => id === playlistId);
      if (summary) replacePlaylistSummary({ ...summary, name: normalizedName });
      deferPlaylistRefresh(undefined, true);
      return { status: "success" };
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    } finally {
      finishPlaylistAction(context);
      if (mutationStarted) finishPlaylistDataMutation(playlistId);
    }
  }

  async function deletePlaylist(playlistId: number): Promise<PlaylistManagementResult> {
    if (!playlists.value.some(({ id }) => id === playlistId)) {
      return { status: "error", message: "目标歌单不存在。" };
    }

    const context = lockPlaylistAction(playlistId);
    if (!context) {
      return { status: "error", message: "该歌单正在处理中，请稍后重试。" };
    }

    let mutationStarted = false;
    try {
      beginPlaylistDataMutation(playlistId);
      mutationStarted = true;
      await invoke<void>("delete_playlist", { playlistId });
      setAvailablePlaylists(playlists.value.filter(({ id }) => id !== playlistId));
      return { status: "success" };
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    } finally {
      finishPlaylistAction(context);
      if (mutationStarted) finishPlaylistDataMutation(playlistId);
    }
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
    } catch (error) {
      setPlaylistActionError(context, `移除歌单条目失败：${errorMessage(error)}`);
    } finally {
      finishPlaylistAction(context);
      if (mutationStarted) finishPlaylistDataMutation(playlistId);
    }
  }

  function isPlaylistItemSetMismatch(error: unknown) {
    return errorMessage(error).includes("Ordered playlist item IDs must exactly match");
  }

  async function reorderPlaylistItems(orderedPlaylistItemIds: readonly number[]) {
    const playlistId = selectedPlaylistId.value;
    if (playlistId === null || pendingPlaylistActionIds.value.has(playlistId)) return;

    const orderedIds = [...orderedPlaylistItemIds];
    let sourceTracks: PlaylistTrackSummary[];
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
      finishPlaylistAction(context);
      if (mutationStarted) finishPlaylistDataMutation(playlistId);
    }
  }

  function invalidateQueries() {
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
      setPlaylistTracksSource(playlistId);
    },
    { flush: "sync" },
  );

  watch(
    availability,
    (value) => {
      if (value === "active") void refreshPlaylists();
      else invalidateQueries();
    },
    { immediate: true, flush: "sync" },
  );

  return {
    playlists: readonly(playlists),
    selectedPlaylistId: readonly(selectedPlaylistId),
    selectedPlaylist: readonly(selectedPlaylist),
    playlistTracks: readonly(playlistTracks),
    isLoadingPlaylists: readonly(isLoadingPlaylists),
    isLoadingPlaylistTracks: readonly(isLoadingPlaylistTracks),
    playlistsError: readonly(playlistsError),
    playlistTracksError: readonly(playlistTracksError),
    pendingPlaylistIds,
    isPlaylistActionPending,
    playlistActionError: readonly(playlistActionError),
    coverTrackId,
    isCoverPending,
    selectPlaylist,
    playTrackFromPlaylist,
    playPlaylistFromPage,
    addPlaylistItemsToNext,
    addPlaylistItemsToQueueEnd,
    renamePlaylist,
    deletePlaylist,
    removePlaylistItems,
    reorderPlaylistItems,
    refreshPlaylists,
  };
}

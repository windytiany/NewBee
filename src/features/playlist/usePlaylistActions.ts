import type { Ref } from "vue";
import type { createPlaylistApi } from "@/features/playlist/api";
import type {
  PlaylistReorderError,
  PlaylistSummary,
  PlaylistTrackSummary,
} from "@/features/playlist/types";

export type PlaylistActionContext = {
  playlistId: number;
  generation: number;
};
type PlaylistManagementResult = { status: "success" } | { status: "error"; message: string };

export type PlaylistMutationState = {
  api: ReturnType<typeof createPlaylistApi>;
  playlists: Readonly<Ref<readonly PlaylistSummary[]>>;
  selectedPlaylistId: Readonly<Ref<number | null>>;
  playlistTracks: Ref<PlaylistTrackSummary[]>;
  playlistTracksPlaylistId: Ref<number | null>;
  loadedPlaylistTracksId: Ref<number | null>;
  isLoadingPlaylistTracks: Readonly<Ref<boolean>>;
  pendingPlaylistActionIds: Ref<Set<number>>;
  setAvailablePlaylists: (playlists: PlaylistSummary[]) => void;
  lockPlaylistAction: (playlistId: number) => PlaylistActionContext | null;
  beginPlaylistAction: (playlistId: number) => PlaylistActionContext | null;
  finishPlaylistAction: (context: PlaylistActionContext) => void;
  setPlaylistActionError: (context: PlaylistActionContext, message: string) => void;
  reportPlaylistActionError: (playlistId: number, message: string) => void;
  getLoadedPlaylistTracks: (playlistId: number) => PlaylistTrackSummary[];
  getTargetPlaylistTracks: (playlistId: number, ids: readonly number[]) => PlaylistTrackSummary[];
  replacePlaylistSummary: (summary: PlaylistSummary) => boolean;
  updatePlaylistSummary: (
    playlistId: number,
    changes: Partial<Pick<PlaylistSummary, "trackCount" | "coverTrackId">>,
  ) => PlaylistSummary | null;
  beginPlaylistDataMutation: (playlistId: number) => void;
  finishPlaylistDataMutation: (playlistId: number) => void;
  deferPlaylistRefresh: (selectPlaylistId?: number, force?: boolean) => void;
};

export function usePlaylistActions(context: PlaylistMutationState) {
  const {
    api,
    playlists,
    selectedPlaylistId,
    playlistTracks,
    playlistTracksPlaylistId,
    loadedPlaylistTracksId,
    pendingPlaylistActionIds,
    setAvailablePlaylists,
    lockPlaylistAction,
    beginPlaylistAction,
    finishPlaylistAction,
    setPlaylistActionError,
    reportPlaylistActionError,
    getLoadedPlaylistTracks,
    getTargetPlaylistTracks,
    replacePlaylistSummary,
    updatePlaylistSummary,
    beginPlaylistDataMutation,
    finishPlaylistDataMutation,
    deferPlaylistRefresh,
  } = context;
  function isPlaylistReorderError(error: unknown): error is PlaylistReorderError {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "item_set_mismatch" || error.code === "failed") &&
      "message" in error &&
      typeof error.message === "string"
    );
  }

  function errorMessage(error: unknown) {
    if (error instanceof Error || isPlaylistReorderError(error)) return error.message;
    return typeof error === "string" ? error : "未知错误";
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
      await api.rename(playlistId, normalizedName);

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
      await api.remove(playlistId);
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

      await api.removeItems(playlistId, targetIds);

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

      await api.reorder(playlistId, orderedIds);
    } catch (error) {
      if (
        selectedPlaylistId.value === playlistId &&
        playlistTracksPlaylistId.value === playlistId &&
        loadedPlaylistTracksId.value === playlistId
      ) {
        playlistTracks.value = originalTracks;
      }
      replacePlaylistSummary(rollbackSummary);
      if (isPlaylistReorderError(error) && error.code === "item_set_mismatch") {
        deferPlaylistRefresh(undefined, true);
      }
      setPlaylistActionError(context, `保存歌单排序失败：${errorMessage(error)}`);
    } finally {
      finishPlaylistAction(context);
      if (mutationStarted) finishPlaylistDataMutation(playlistId);
    }
  }

  return { renamePlaylist, deletePlaylist, removePlaylistItems, reorderPlaylistItems };
}

import { invoke } from "@tauri-apps/api/core";
import { computed, readonly, ref, watch } from "vue";
import type { Ref } from "vue";
import { createPlaylistApi } from "@/features/playlist/api";
import { createTracksApi } from "@/features/tracks/api";
import type { TrackDetails } from "@/features/tracks/types";
import type { TracksChange } from "@/features/tracks/events";
import {
  usePlaylistActions,
  type PlaylistActionContext,
} from "@/features/playlist/composables/useActions";
import { usePlaylistPlayback } from "@/features/playlist/composables/usePlayback";
import { usePlaylistSelection } from "@/features/playlist/composables/useSelection";
import type {
  PlaylistReorderError,
  PlaylistSummary,
  PlaylistTrackSummary,
} from "@/features/playlist/types";

type DeferredPlaylistRefresh = {
  force: boolean;
  selectPlaylistId?: number;
};
/** Unavailable before mount and after disposal; background still permits forced refreshes. */
export type PlaylistAvailability = "unavailable" | "active" | "background";

export function usePlaylistState(availability: Readonly<Ref<PlaylistAvailability>>) {
  const {
    availablePlaylists: playlists,
    selectedPlaylistId,
    selectedPlaylist,
    setAvailablePlaylists,
    selectPlaylist: setSelectedPlaylist,
  } = usePlaylistSelection();
  const playlistTracks = ref<PlaylistTrackSummary[]>([]);
  const playlistTracksPlaylistId = ref<number | null>(null);
  const loadedPlaylistTracksId = ref<number | null>(null);
  const isLoadingPlaylists = ref(false);
  const isLoadingPlaylistTracks = ref(false);
  const playlistsError = ref("");
  const playlistTracksError = ref("");
  const trackMetadataError = ref("");
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
  const api = createPlaylistApi(invoke);
  let playlistsRequestGeneration = 0;
  let playlistTracksRequestGeneration = 0;
  let playlistContextGeneration = 0;
  let deferredPlaylistRefresh: DeferredPlaylistRefresh | null = null;
  const activePlaylistDataMutations = new Set<number>();
  const tracksApi = createTracksApi(invoke);
  const metadataRows = new Map<number, PlaylistTrackSummary[]>();
  const pendingMetadata = new Map<number, number>();
  const loadingMetadata = new Map<number, TrackDetails>();
  let metadataRevision = 0;
  let metadataRequestPending = false;
  let pendingAllMetadata = false;

  watch(
    () => playlistTracks.value.map((row) => [row.trackId, row] as const),
    (rows) => {
      metadataRows.clear();
      for (const [id, row] of rows) {
        const entries = metadataRows.get(id);
        if (entries) entries.push(row);
        else metadataRows.set(id, [row]);
      }
    },
    { flush: "sync" },
  );

  function patchTrackMetadata(tracks: readonly TrackDetails[]) {
    for (const track of tracks) {
      for (const row of metadataRows.get(track.id) ?? []) {
        Object.assign(row, {
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationMs: track.durationMs,
        });
      }
      if (isLoadingPlaylistTracks.value) loadingMetadata.set(track.id, track);
    }
  }

  async function refreshTrackMetadata() {
    if (
      availability.value !== "active" ||
      isLoadingPlaylistTracks.value ||
      metadataRequestPending ||
      loadedPlaylistTracksId.value !== selectedPlaylistId.value
    )
      return;
    const pending = new Map([...pendingMetadata].filter(([id]) => metadataRows.has(id)));
    if (!pending.size) return;
    const playlistId = loadedPlaylistTracksId.value;
    metadataRequestPending = true;
    try {
      const tracks = await tracksApi.getTracks([...pending.keys()]);
      if (!canQuery(true) || playlistId !== loadedPlaylistTracksId.value) return;
      patchTrackMetadata(
        tracks.filter(
          (track) =>
            pending.has(track.id) && pendingMetadata.get(track.id) === pending.get(track.id),
        ),
      );
      for (const [id, revision] of pending) {
        if (pendingMetadata.get(id) === revision) pendingMetadata.delete(id);
      }
      trackMetadataError.value = "";
    } catch (error) {
      if (
        canQuery(true) &&
        playlistId === loadedPlaylistTracksId.value &&
        [...pending].some(([id, revision]) => pendingMetadata.get(id) === revision)
      ) {
        trackMetadataError.value = `读取歌单曲目信息失败：${errorMessage(error)}`;
      }
    } finally {
      metadataRequestPending = false;
      if (
        [...pendingMetadata].some(
          ([id, revision]) => metadataRows.has(id) && pending.get(id) !== revision,
        )
      ) {
        void refreshTrackMetadata();
      }
    }
  }

  function updateTrackMetadata(change: TracksChange) {
    const revision = ++metadataRevision;
    const ids = change.trackIds ?? [...metadataRows.keys()];
    if (change.trackIds === undefined && isLoadingPlaylistTracks.value) pendingAllMetadata = true;
    for (const id of ids) {
      if (metadataRows.has(id) || isLoadingPlaylistTracks.value) pendingMetadata.set(id, revision);
    }
    const affectedIds = new Set(ids);
    const tracks = (change.tracks ?? []).filter((track) => affectedIds.has(track.id));
    patchTrackMetadata(tracks);
    if (tracks.length) trackMetadataError.value = "";
    for (const track of tracks) pendingMetadata.delete(track.id);
    void refreshTrackMetadata();
  }

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

  function setPlaylistTracksSource(playlistId: number | null) {
    if (playlistTracksPlaylistId.value === playlistId) return;

    ++playlistTracksRequestGeneration;
    playlistTracksPlaylistId.value = playlistId;
    loadedPlaylistTracksId.value = null;
    pendingMetadata.clear();
    pendingAllMetadata = false;
    loadingMetadata.clear();
    trackMetadataError.value = "";
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
    const availableTracks = new Map(sourceTracks.map((track) => [track.playlistItemId, track]));
    if (playlistItemIds.some((playlistItemId) => !availableTracks.has(playlistItemId))) {
      throw new Error("部分目标条目不属于当前已加载的歌单。");
    }

    return [...new Set(playlistItemIds)].map((playlistItemId) =>
      availableTracks.get(playlistItemId)!,
    );
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
    pendingMetadata.clear();
    pendingAllMetadata = false;
    loadingMetadata.clear();
    playlistTracksError.value = "";
    isLoadingPlaylistTracks.value = true;

    try {
      const result = await api.listTracks(playlistId);
      if (!isPlaylistTracksRequestCurrent(playlistId, generation, force)) return;

      playlistTracks.value = result;
      if (pendingAllMetadata) {
        for (const id of metadataRows.keys()) pendingMetadata.set(id, metadataRevision);
        pendingAllMetadata = false;
      }
      patchTrackMetadata([...loadingMetadata.values()]);
      loadingMetadata.clear();
      loadedPlaylistTracksId.value = playlistId;
      trackMetadataError.value = "";
      syncPlaylistSummaryFromTracks(playlistId, result);
    } catch (error) {
      if (!isPlaylistTracksRequestCurrent(playlistId, generation, force)) return;
      playlistTracksError.value = `读取歌单曲目失败：${errorMessage(error)}`;
    } finally {
      if (isPlaylistTracksRequestCurrent(playlistId, generation, force)) {
        isLoadingPlaylistTracks.value = false;
        void refreshTrackMetadata();
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
      const result = await api.list();
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

  const actionContext = {
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
    isLoadingPlaylistTracks,
  };
  const actions = usePlaylistActions(actionContext);
  const playback = usePlaylistPlayback(actionContext);

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
    ...actions,
    ...playback,
    playlists: readonly(playlists),
    selectedPlaylistId: readonly(selectedPlaylistId),
    selectedPlaylist: readonly(selectedPlaylist),
    playlistTracks: readonly(playlistTracks),
    isLoadingPlaylists: readonly(isLoadingPlaylists),
    isLoadingPlaylistTracks: readonly(isLoadingPlaylistTracks),
    playlistsError: readonly(playlistsError),
    playlistTracksError: readonly(playlistTracksError),
    trackMetadataError: readonly(trackMetadataError),
    pendingPlaylistIds,
    isPlaylistActionPending,
    playlistActionError: readonly(playlistActionError),
    coverTrackId,
    isCoverPending,
    selectPlaylist,
    refreshPlaylists,
    updateTrackMetadata,
  };
}

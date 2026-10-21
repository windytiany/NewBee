import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { ref } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import type { Ref } from "vue";
import type { LibraryInvoker } from "@/features/library/api";
import { createLibraryApi } from "@/features/library/api";
import { createPlaylistApi } from "@/features/playlist/api";
import { usePlaybackSession } from "@/features/playback/session";
import { useLibraryRemoval } from "@/features/library/removal/useRemoval";
import type { LibraryAlbumSelection } from "@/features/library/types";
import type { TrackSummary } from "@/features/tracks/types";
import type { PlaybackDisplayTrack } from "@/features/playback/types";

export type LibraryActionState = {
  isTrackActionPending: Ref<boolean>;
  trackActionError: Ref<string>;
  trackActionMessage: Ref<string>;
  trackActionMessageType: Ref<"success" | "warning">;
  trackActionRemoval: Ref<{
    deletedCount: number;
    failedCount: number;
    queueSyncFailed: boolean;
  } | null>;
};

export function useLibraryActions(
  tracks: Ref<TrackSummary[]>,
  isLoadingTracks: Ref<boolean>,
  invokeCommand: LibraryInvoker,
) {
  const libraryApi = createLibraryApi(invokeCommand);
  const playlistApi = createPlaylistApi(invokeCommand);
  const isTrackActionPending = ref(false);
  watchActivity(isTrackActionPending);
  const trackActionError = ref("");
  const trackActionMessage = ref("");
  const trackActionMessageType = ref<"success" | "warning">("success");
  const trackActionRemoval: LibraryActionState["trackActionRemoval"] = ref(null);
  const playbackSession = usePlaybackSession();
  const { currentTrack, activeQueueRowKey, playbackStatus, isPlaybackCommandPending } =
    playbackSession.state;
  const {
    playTracks,
    addTracksToNext: enqueueTracksToNext,
    addTracksToQueueEnd: enqueueTracksToQueueEnd,
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
    trackActionRemoval.value = null;
    try {
      if (!(await action())) {
        trackActionError.value = `${name}失败：操作未执行。`;
        return false;
      }
      return true;
    } catch (error) {
      logger.error("library", "action_failed", error, { action: name });
      trackActionError.value = `${name}失败`;
      return false;
    } finally {
      isTrackActionPending.value = false;
    }
  }

  const { removeTrackFromLibrary, removeAlbumFromLibrary } = useLibraryRemoval({
    tracks,
    isLoadingTracks,
    libraryApi,
    playbackSession,
    actions: {
      isTrackActionPending,
      trackActionError,
      trackActionMessage,
      trackActionMessageType,
      trackActionRemoval,
    },
    runTrackAction,
  });

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

  function playAlbumFromLibrary(selection: LibraryAlbumSelection) {
    return runTrackAction("播放专辑", async () => {
      const sourceTracks = await loadAlbumActionTracks(selection);
      if (sourceTracks.length === 0) return false;

      return playTracks(toPlaybackDisplayTracks(sourceTracks), null, false);
    });
  }

  function toggleCurrentAlbumPlayback() {
    if (
      isLoadingTracks.value ||
      isPlaybackCommandPending.value ||
      !tracks.value.some((track) => track.id === currentTrack.value?.trackId)
    ) {
      return Promise.resolve(false);
    }
    return runTrackAction("切换播放状态", () => playbackSession.togglePlayback());
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
      trackActionRemoval.value = null;
      return { successfulTrackIds, failures: unavailableTracks };
    }

    isTrackActionPending.value = true;
    trackActionError.value = "";
    trackActionMessage.value = "";
    trackActionRemoval.value = null;
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
    const sourceById = new Map(sourceTracks.map((track) => [track.id, track]));
    const availableIds = trackIds.filter((trackId) => {
      if (sourceById.has(trackId)) return true;
      failures.push({ trackId, trackName: `曲目 ${trackId}`, message: "曲目已不可用" });
      return false;
    });
    try {
      const results = await playlistApi.appendTracks(playlistId, availableIds);
      for (const result of results) {
        if (result.status === "added") successfulTrackIds.push(result.trackId);
        else {
          logger.warn("library", "playlist_add_failed", result.error, {
            trackId: result.trackId,
            playlistId,
          });
          failures.push({
            trackId: result.trackId,
            trackName: sourceById.get(result.trackId)?.title ?? `曲目 ${result.trackId}`,
            message: result.error,
          });
        }
      }
    } catch (error) {
      logger.warn("library", "playlist_add_failed", error, { playlistId });
      failures.push(
        ...availableIds.map((trackId) => ({
          trackId,
          trackName: sourceById.get(trackId)?.title ?? `曲目 ${trackId}`,
          message: errorMessage(error),
        })),
      );
    }

    trackActionMessageType.value = failures.length ? "warning" : "success";
    trackActionMessage.value = failures.length
      ? t("已添加 {count} 首，{failed} 首失败", {
          count: successfulTrackIds.length,
          failed: failures.length,
        })
      : t("已添加 {count} 首到歌单", { count: successfulTrackIds.length });
    return { successfulTrackIds, failures };
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

  return {
    isTrackActionPending,
    trackActionError,
    trackActionMessage,
    trackActionMessageType,
    trackActionRemoval,
    currentTrack,
    activeQueueRowKey,
    playbackStatus,
    isPlaybackCommandPending,
    toggleCurrentAlbumPlayback,
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

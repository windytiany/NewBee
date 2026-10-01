import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { Ref } from "vue";
import { usePersistentLibrarySelection } from "@/library/selection";
import type { LibraryAlbumSelection } from "@/library/selection";
import { usePlaybackSession } from "@/playback/session";
import { LIBRARY_SCAN_COMPLETED_EVENT } from "@/library/scan";
import type { AlbumArtistSummary } from "@/types/artist";
import type { AlbumSummary } from "@/types/album";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";
import type { TrackSummary } from "@/types/track";

type LibraryTrackRemovalResult =
  | { status: "not-deleted"; message: string }
  | { status: "deleted" }
  | {
      status: "deleted-queue-sync-failed";
      issue: "stop-failed" | "stop-unconfirmed" | "superseded" | "queue-error";
      message: string;
    };

export function useLibraryPage(active: Readonly<Ref<boolean>>) {
  const artists = ref<AlbumArtistSummary[]>([]);
  const albums = ref<AlbumSummary[]>([]);
  const tracks = ref<TrackSummary[]>([]);
  const isLoadingArtists = ref(false);
  const isLoadingAlbums = ref(false);
  const isLoadingTracks = ref(false);
  const artistsError = ref("");
  const albumsError = ref("");
  const tracksError = ref("");
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
  const {
    selectedGroup,
    selectedAlbum,
    setAvailableGroups,
    setAvailableAlbums,
    selectGroup,
    selectAlbum: setSelectedAlbum,
  } = usePersistentLibrarySelection();

  let isMounted = false;
  let isSubscribedToLibraryScan = false;
  let artistsRequestGeneration = 0;
  let albumsRequestGeneration = 0;
  let tracksRequestGeneration = 0;

  function sameGroup(left: AlbumArtistSummary | null, right: AlbumArtistSummary | null) {
    return left?.albumArtist === right?.albumArtist;
  }

  function sameAlbumSelection(
    left: { albumArtist: string | null; album: string | null } | null,
    right: { albumArtist: string | null; album: string | null } | null,
  ) {
    return left?.albumArtist === right?.albumArtist && left?.album === right?.album;
  }

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

  async function refreshLibrary() {
    if (!isMounted || !active.value) return;

    const generation = ++artistsRequestGeneration;
    ++albumsRequestGeneration;
    ++tracksRequestGeneration;
    isLoadingAlbums.value = false;
    isLoadingTracks.value = selectedAlbum.value !== null;
    albumsError.value = "";
    tracksError.value = "";
    isLoadingArtists.value = true;
    artistsError.value = "";

    try {
      const result = await invoke<AlbumArtistSummary[]>("list_album_artists");
      if (!isMounted || !active.value || generation !== artistsRequestGeneration) return;

      artists.value = result;
      setAvailableGroups(result);
      const group = selectedGroup.value;
      if (group) {
        void loadAlbums(group);
      } else {
        albums.value = [];
        tracks.value = [];
      }
    } catch (error) {
      if (!isMounted || !active.value || generation !== artistsRequestGeneration) return;
      artistsError.value = `读取专辑演出者失败：${errorMessage(error)}`;
      isLoadingTracks.value = false;
    } finally {
      if (isMounted && active.value && generation === artistsRequestGeneration) {
        isLoadingArtists.value = false;
      }
    }
  }

  async function loadAlbums(group: AlbumArtistSummary) {
    if (!isMounted || !active.value || !sameGroup(selectedGroup.value, group)) return;

    const generation = ++albumsRequestGeneration;
    ++tracksRequestGeneration;
    albums.value = [];
    tracks.value = [];
    isLoadingTracks.value = selectedAlbum.value !== null;
    tracksError.value = "";
    albumsError.value = "";
    isLoadingAlbums.value = true;

    try {
      const result = await invoke<AlbumSummary[]>("list_albums", {
        albumArtist: group.albumArtist,
      });
      if (
        !isMounted ||
        !active.value ||
        generation !== albumsRequestGeneration ||
        !sameGroup(selectedGroup.value, group)
      ) {
        return;
      }

      albums.value = result;
      setAvailableAlbums(group.albumArtist, result);
      const selection = selectedAlbum.value;
      if (selection && selection.albumArtist === group.albumArtist) {
        void loadTracks(selection);
      } else {
        isLoadingTracks.value = false;
      }
    } catch (error) {
      if (!isMounted || !active.value || generation !== albumsRequestGeneration) return;
      albumsError.value = `读取专辑失败：${errorMessage(error)}`;
      isLoadingTracks.value = false;
    } finally {
      if (isMounted && active.value && generation === albumsRequestGeneration) {
        isLoadingAlbums.value = false;
      }
    }
  }

  async function loadTracks(selection: { albumArtist: string | null; album: string | null }) {
    if (!isMounted || !active.value || !sameAlbumSelection(selectedAlbum.value, selection)) return;

    const generation = ++tracksRequestGeneration;
    tracks.value = [];
    tracksError.value = "";
    isLoadingTracks.value = true;

    try {
      const result = await invoke<TrackSummary[]>("list_album_tracks", {
        albumArtist: selection.albumArtist,
        album: selection.album,
      });
      if (
        !isMounted ||
        !active.value ||
        generation !== tracksRequestGeneration ||
        !sameAlbumSelection(selectedAlbum.value, selection)
      ) {
        return;
      }

      tracks.value = result;
    } catch (error) {
      if (
        !isMounted ||
        !active.value ||
        generation !== tracksRequestGeneration ||
        !sameAlbumSelection(selectedAlbum.value, selection)
      ) {
        return;
      }
      tracksError.value = `读取曲目失败：${errorMessage(error)}`;
    } finally {
      if (isMounted && active.value && generation === tracksRequestGeneration) {
        isLoadingTracks.value = false;
      }
    }
  }

  function selectArtist(artist: AlbumArtistSummary) {
    selectGroup(artist);
    void loadAlbums(artist);
  }

  function selectAlbum(album: AlbumSummary | null) {
    setSelectedAlbum(album);
    ++tracksRequestGeneration;
    tracks.value = [];
    tracksError.value = "";
    isLoadingTracks.value = false;

    const selection = selectedAlbum.value;
    if (selection) void loadTracks(selection);
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
    await playTracks(displayedTracks, `album-track:${firstTrack.id}`);
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
        await invoke<void>("add_track_to_playlist", { trackId, playlistId });
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
      if (result.status !== "not-deleted") await refreshLibrary();
      return result;
    } finally {
      isTrackActionPending.value = false;
    }
  }

  async function deleteLibraryTrack(trackId: number): Promise<LibraryTrackRemovalResult> {
    try {
      await invoke<void>("remove_track_from_library", { trackId });
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
    return invoke<TrackSummary[]>("list_album_tracks", selection);
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
    let deletedCount = 0;
    const failures: string[] = [];
    const completed = await runTrackAction("从曲库删除专辑", async () => {
      const sourceTracks = await loadAlbumActionTracks(selection);
      for (const track of sourceTracks) {
        const result = await deleteLibraryTrack(track.id);
        if (result.status !== "not-deleted") deletedCount++;
        if (result.status !== "deleted") {
          failures.push(`${track.title ?? `曲目 ${track.id}`}（${result.message}）`);
        }
      }
      if (deletedCount > 0) await refreshLibrary();
      trackActionError.value = failures.length ? failures.join("、") : "";
      trackActionMessageType.value = "success";
      trackActionMessage.value = `已从曲库删除 ${deletedCount} 首曲目。`;
      return true;
    });
    return {
      completed: completed && failures.length === 0,
      deletedCount,
      message: trackActionError.value,
    };
  }

  function onLibraryScanCompleted() {
    void refreshLibrary();
  }

  function activate() {
    if (!isMounted || !active.value) return;

    if (!isSubscribedToLibraryScan) {
      globalThis.window.addEventListener(LIBRARY_SCAN_COMPLETED_EVENT, onLibraryScanCompleted);
      isSubscribedToLibraryScan = true;
    }
    void refreshLibrary();
  }

  function deactivate() {
    if (isSubscribedToLibraryScan) {
      globalThis.window.removeEventListener(LIBRARY_SCAN_COMPLETED_EVENT, onLibraryScanCompleted);
      isSubscribedToLibraryScan = false;
    }

    ++artistsRequestGeneration;
    ++albumsRequestGeneration;
    ++tracksRequestGeneration;
    isLoadingArtists.value = false;
    isLoadingAlbums.value = false;
    isLoadingTracks.value = false;
  }

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
    artists,
    albums,
    tracks,
    isLoadingArtists,
    isLoadingAlbums,
    isLoadingTracks,
    artistsError,
    albumsError,
    tracksError,
    isTrackActionPending,
    trackActionError,
    trackActionMessage,
    trackActionMessageType,
    currentTrack,
    activeQueueRowKey,
    selectedGroup,
    selectedAlbum,
    refreshLibrary,
    selectArtist,
    selectAlbum,
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

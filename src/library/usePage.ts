import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { Ref } from "vue";
import { usePersistentLibrarySelection } from "@/library/selection";
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
  const selectedTrackId = ref<number | null>(null);
  const playbackSession = usePlaybackSession();
  const { currentTrack } = playbackSession.state;
  const { playTracks, addToNext, addToQueueEnd, removeTrackFromQueue } = playbackSession;
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

  function resetSelectedTrackState(clearSelection: boolean) {
    if (clearSelection) selectedTrackId.value = null;
  }

  async function runTrackAction(name: string, action: () => Promise<boolean>) {
    if (isTrackActionPending.value) return false;

    isTrackActionPending.value = true;
    trackActionError.value = "";
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
        resetSelectedTrackState(true);
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
        resetSelectedTrackState(true);
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
      const trackId = selectedTrackId.value;
      if (trackId !== null) {
        if (!result.some((track) => track.id === trackId)) {
          resetSelectedTrackState(true);
        }
      }
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
    const groupChanged = selectedGroup.value?.albumArtist !== artist.albumArtist;
    selectGroup(artist);
    if (groupChanged) resetSelectedTrackState(true);
    void loadAlbums(artist);
  }

  function selectAlbum(album: AlbumSummary | null) {
    resetSelectedTrackState(true);
    setSelectedAlbum(album);
    ++tracksRequestGeneration;
    tracks.value = [];
    tracksError.value = "";
    isLoadingTracks.value = false;

    const selection = selectedAlbum.value;
    if (selection) void loadTracks(selection);
  }

  function selectTrack(trackId: number) {
    if (!tracks.value.some((track) => track.id === trackId)) return;
    if (selectedTrackId.value === trackId) return;

    resetSelectedTrackState(true);
    selectedTrackId.value = trackId;
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

  function addTrackToNext(trackId: number) {
    const track = findLibraryTrack(trackId);
    if (!track || isLoadingTracks.value) return Promise.resolve(false);
    return runTrackAction("添加为下一首", () => addToNext(toQueueTrack(track)));
  }

  function addTrackToQueueEnd(trackId: number) {
    const track = findLibraryTrack(trackId);
    if (!track || isLoadingTracks.value) return Promise.resolve(false);
    return runTrackAction("添加到队尾", () => addToQueueEnd(toQueueTrack(track)));
  }

  function addTrackToPlaylist(trackId: number, playlistId: number) {
    const track = findLibraryTrack(trackId);
    if (!track || isLoadingTracks.value) return Promise.resolve(false);
    return runTrackAction("添加到播放列表", async () => {
      await invoke<void>("add_track_to_playlist", { trackId, playlistId });
      return true;
    });
  }

  async function removeTrackFromLibrary(trackId: number): Promise<LibraryTrackRemovalResult> {
    if (!findLibraryTrack(trackId) || isLoadingTracks.value || isTrackActionPending.value) {
      const message = "从曲库删除失败：曲目不可用或当前有操作正在进行。";
      trackActionError.value = message;
      return { status: "not-deleted", message };
    }

    isTrackActionPending.value = true;
    trackActionError.value = "";
    try {
      try {
        await invoke<void>("remove_track_from_library", { trackId });
      } catch (error) {
        const message = `从曲库删除失败：${errorMessage(error)}`;
        trackActionError.value = message;
        return { status: "not-deleted", message };
      }

      let queueResult:
        | Awaited<ReturnType<typeof removeTrackFromQueue>>
        | { status: "queue-error"; message: string };
      try {
        queueResult = await removeTrackFromQueue(trackId);
      } catch (error) {
        queueResult = { status: "queue-error", message: errorMessage(error) };
      }
      await refreshLibrary();

      if (queueResult.status === "removed" || queueResult.status === "not-found") {
        return { status: "deleted" };
      }

      let issue: Extract<
        LibraryTrackRemovalResult,
        { status: "deleted-queue-sync-failed" }
      >["issue"];
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
    } finally {
      isTrackActionPending.value = false;
    }
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
    resetSelectedTrackState(true);
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
    selectedTrackId,
    currentTrack,
    selectedGroup,
    selectedAlbum,
    refreshLibrary,
    selectArtist,
    selectAlbum,
    selectTrack,
    playTrackFromLibrary,
    playAlbumFromLibrary,
    addTrackToNext,
    addTrackToQueueEnd,
    addTrackToPlaylist,
    removeTrackFromLibrary,
  };
}

import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { Ref } from "vue";
import { usePlaybackState } from "@/composables/usePlaybackState";
import { usePersistentPlaylistSelection } from "@/composables/usePersistentPlaylistSelection";
import { LIBRARY_SCAN_COMPLETED_EVENT } from "@/composables/useLibraryScan";
import type { Playlist, PlaylistTrackData } from "@/types/playlist";

export function usePlaylistPage(active: Readonly<Ref<boolean>>) {
  const {
    availablePlaylists: playlists,
    selectedPlaylistId,
    selectedPlaylist,
    setAvailablePlaylists,
    selectPlaylist: setSelectedPlaylist,
  } = usePersistentPlaylistSelection();
  const playlistTracks = ref<PlaylistTrackData[]>([]);
  const isLoadingPlaylists = ref(false);
  const isLoadingPlaylistTracks = ref(false);
  const playlistsError = ref("");
  const playlistTracksError = ref("");
  const { playTrack } = usePlaybackState();
  let isMounted = false;
  let isSubscribedToLibraryScan = false;
  let playlistsRequestGeneration = 0;
  let playlistTracksRequestGeneration = 0;

  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === "string" ? error : "未知错误";
  }

  async function loadPlaylistTracks(playlistId: number) {
    if (!isMounted || !active.value || selectedPlaylistId.value !== playlistId) return;

    const generation = ++playlistTracksRequestGeneration;
    playlistTracks.value = [];
    playlistTracksError.value = "";
    isLoadingPlaylistTracks.value = true;

    try {
      const result = await invoke<PlaylistTrackData[]>("list_playlist_tracks", { playlistId });
      if (
        !isMounted ||
        !active.value ||
        generation !== playlistTracksRequestGeneration ||
        selectedPlaylistId.value !== playlistId
      ) {
        return;
      }

      playlistTracks.value = result;
    } catch (error) {
      if (
        !isMounted ||
        !active.value ||
        generation !== playlistTracksRequestGeneration ||
        selectedPlaylistId.value !== playlistId
      ) {
        return;
      }
      playlistTracksError.value = `读取歌单曲目失败：${errorMessage(error)}`;
    } finally {
      if (
        isMounted &&
        active.value &&
        generation === playlistTracksRequestGeneration &&
        selectedPlaylistId.value === playlistId
      ) {
        isLoadingPlaylistTracks.value = false;
      }
    }
  }

  async function refreshPlaylists(selectPlaylistId?: number) {
    if (!isMounted || !active.value) return;

    const generation = ++playlistsRequestGeneration;
    ++playlistTracksRequestGeneration;
    isLoadingPlaylists.value = true;
    isLoadingPlaylistTracks.value = selectedPlaylistId.value !== null;
    playlistsError.value = "";
    playlistTracksError.value = "";

    try {
      const result = await invoke<Playlist[]>("list_playlists");
      if (!isMounted || !active.value || generation !== playlistsRequestGeneration) return;

      setAvailablePlaylists(result);
      if (selectPlaylistId !== undefined) {
        const createdPlaylist = result.find(({ id }) => id === selectPlaylistId);
        if (createdPlaylist) setSelectedPlaylist(createdPlaylist);
      }

      const playlistId = selectedPlaylistId.value;
      if (playlistId === null) {
        playlistTracks.value = [];
        isLoadingPlaylistTracks.value = false;
      } else {
        void loadPlaylistTracks(playlistId);
      }
    } catch (error) {
      if (!isMounted || !active.value || generation !== playlistsRequestGeneration) return;
      playlistsError.value = `读取歌单失败：${errorMessage(error)}`;
      isLoadingPlaylistTracks.value = false;
    } finally {
      if (isMounted && active.value && generation === playlistsRequestGeneration) {
        isLoadingPlaylists.value = false;
      }
    }
  }

  function selectPlaylist(playlist: Playlist) {
    if (selectedPlaylistId.value === playlist.id) return;

    setSelectedPlaylist(playlist);
    void loadPlaylistTracks(playlist.id);
  }

  function playTrackFromPlaylist(trackId: number) {
    if (!playlistTracks.value.some((track) => track.trackId === trackId)) return;
    void playTrack(trackId);
  }

  function onLibraryScanCompleted() {
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
    selectPlaylist,
    playTrackFromPlaylist,
    refreshPlaylists,
  };
}

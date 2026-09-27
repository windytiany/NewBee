<template>
  <ResizableThreeColumnLayout>
    <template #left>
      <PlaylistList
        :playlists="playlists"
        :selected-playlist-id="selectedPlaylistId"
        :is-loading="isLoadingPlaylists"
        :error="playlistsError"
        @select="selectPlaylist"
        @create="showCreatePlaylistDialog"
      />
    </template>

    <template #center>
      <PlaylistBrowser
        :playlist="selectedPlaylist"
        :tracks="playlistTracks"
        :is-loading-playlists="isLoadingPlaylists"
        :playlists-error="playlistsError"
        :has-playlists="playlists.length > 0"
        :is-loading-tracks="isLoadingPlaylistTracks"
        :tracks-error="playlistTracksError"
        @play-track="playTrackFromPlaylist"
      />
    </template>

    <template #right-top>
      <TrackList :tracks="[]" title="播放队列" empty-message="播放队列为空。" />
    </template>

    <template #right-bottom>
      <TrackInfo :details="null" empty-message="歌单页面暂不提供曲目详情。" />
    </template>
  </ResizableThreeColumnLayout>
  <CreatePlaylistDialog ref="createPlaylistDialog" @created="onPlaylistCreated" />
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref } from "vue";
import { usePlaybackState } from "../composables/usePlaybackState";
import { usePersistentPlaylistSelection } from "../composables/usePersistentPlaylistSelection";
import { LIBRARY_SCAN_COMPLETED_EVENT } from "../composables/useLibraryScan";
import PlaylistBrowser from "../components/playlist/PlaylistBrowser.vue";
import CreatePlaylistDialog from "../components/playlist/CreatePlaylistDialog.vue";
import PlaylistList from "../components/playlist/PlaylistList.vue";
import ResizableThreeColumnLayout from "../components/layout/ResizableThreeColumnLayout.vue";
import TrackInfo from "../components/track/TrackInfo.vue";
import TrackList from "../components/track/TrackList.vue";
import type { Playlist, PlaylistTrackData } from "../types/playlist";

const {
  availablePlaylists: playlists,
  selectedPlaylistId,
  selectedPlaylist,
  setAvailablePlaylists,
  selectPlaylist: setSelectedPlaylist,
} = usePersistentPlaylistSelection();
const createPlaylistDialog = ref<InstanceType<typeof CreatePlaylistDialog> | null>(null);
const playlistTracks = ref<PlaylistTrackData[]>([]);
const isLoadingPlaylists = ref(false);
const isLoadingPlaylistTracks = ref(false);
const playlistsError = ref("");
const playlistTracksError = ref("");
const { playTrack } = usePlaybackState();
let isMounted = false;
let playlistsRequestGeneration = 0;
let playlistTracksRequestGeneration = 0;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

async function loadPlaylistTracks(playlistId: number) {
  if (!isMounted || selectedPlaylistId.value !== playlistId) return;

  const generation = ++playlistTracksRequestGeneration;
  playlistTracks.value = [];
  playlistTracksError.value = "";
  isLoadingPlaylistTracks.value = true;

  try {
    const result = await invoke<PlaylistTrackData[]>("list_playlist_tracks", { playlistId });
    if (
      !isMounted ||
      generation !== playlistTracksRequestGeneration ||
      selectedPlaylistId.value !== playlistId
    ) {
      return;
    }

    playlistTracks.value = result;
  } catch (error) {
    if (
      !isMounted ||
      generation !== playlistTracksRequestGeneration ||
      selectedPlaylistId.value !== playlistId
    ) {
      return;
    }
    playlistTracksError.value = `读取歌单曲目失败：${errorMessage(error)}`;
  } finally {
    if (
      isMounted &&
      generation === playlistTracksRequestGeneration &&
      selectedPlaylistId.value === playlistId
    ) {
      isLoadingPlaylistTracks.value = false;
    }
  }
}

async function refreshPlaylists(selectPlaylistId?: number) {
  if (!isMounted) return;

  const generation = ++playlistsRequestGeneration;
  ++playlistTracksRequestGeneration;
  isLoadingPlaylists.value = true;
  isLoadingPlaylistTracks.value = selectedPlaylistId.value !== null;
  playlistsError.value = "";
  playlistTracksError.value = "";

  try {
    const result = await invoke<Playlist[]>("list_playlists");
    if (!isMounted || generation !== playlistsRequestGeneration) return;

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
    if (!isMounted || generation !== playlistsRequestGeneration) return;
    playlistsError.value = `读取歌单失败：${errorMessage(error)}`;
    isLoadingPlaylistTracks.value = false;
  } finally {
    if (isMounted && generation === playlistsRequestGeneration) {
      isLoadingPlaylists.value = false;
    }
  }
}

function showCreatePlaylistDialog() {
  createPlaylistDialog.value?.show();
}

function onPlaylistCreated(playlistId: number) {
  void refreshPlaylists(playlistId);
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

onMounted(() => {
  isMounted = true;
  globalThis.window.addEventListener(LIBRARY_SCAN_COMPLETED_EVENT, onLibraryScanCompleted);
  void refreshPlaylists();
});

onUnmounted(() => {
  isMounted = false;
  ++playlistsRequestGeneration;
  ++playlistTracksRequestGeneration;
  globalThis.window.removeEventListener(LIBRARY_SCAN_COMPLETED_EVENT, onLibraryScanCompleted);
});
</script>

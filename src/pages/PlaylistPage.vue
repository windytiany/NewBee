<template>
  <ResizableThreeColumnLayout>
    <template #left>
      <PlaylistList
        :playlists="playlists"
        :selected-playlist-id="selectedPlaylistId"
        :is-loading="isLoadingPlaylists"
        :error="playlistsError"
        @select="selectPlaylist"
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
      />
    </template>

    <template #right-top>
      <TrackList
        :tracks="trackListTracks"
        title="歌单曲目"
        :current-track-id="null"
        :selected-track-id="null"
        :is-loading="isLoadingPlaylistTracks || (isLoadingPlaylists && playlists.length === 0)"
        :error="playlistTracksError || playlistsError"
        :empty-message="
          selectedPlaylist
            ? '此歌单暂无歌曲。'
            : playlists.length > 0
              ? '选择歌单后显示其中的歌曲。'
              : '还没有歌单。'
        "
      />
    </template>

    <template #right-bottom>
      <TrackInfo :details="null" empty-message="歌单页面暂不提供曲目详情。" />
    </template>
  </ResizableThreeColumnLayout>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { usePersistentPlaylistSelection } from "../composables/usePersistentPlaylistSelection";
import { LIBRARY_SCAN_COMPLETED_EVENT } from "../composables/useLibraryScan";
import PlaylistBrowser from "../components/playlist/PlaylistBrowser.vue";
import PlaylistList from "../components/playlist/PlaylistList.vue";
import ResizableThreeColumnLayout from "../components/layout/ResizableThreeColumnLayout.vue";
import TrackInfo from "../components/track/TrackInfo.vue";
import TrackList from "../components/track/TrackList.vue";
import { formatTrackDuration } from "../components/track/formatTrackDuration.ts";
import type { Playlist, PlaylistTrackData } from "../types/playlist";

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
const trackListTracks = computed(() =>
  playlistTracks.value.map((track) => ({
    id: track.trackId,
    rowKey: track.playlistItemId,
    title: track.title ?? "未知曲目",
    album: track.album ?? "未知专辑",
    duration: formatTrackDuration(track.durationMs) ?? "时长未知",
  })),
);

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

async function refreshPlaylists() {
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

function selectPlaylist(playlist: Playlist) {
  if (selectedPlaylistId.value === playlist.id) return;

  setSelectedPlaylist(playlist);
  void loadPlaylistTracks(playlist.id);
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

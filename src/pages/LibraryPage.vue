<template>
  <ResizableThreeColumnLayout>
    <template #left>
      <GroupList
        :artists="artists"
        :selected-artist="selectedGroup"
        :is-loading="isLoadingArtists"
        :error="artistsError"
        @select="selectArtist"
      />
    </template>

    <template #center>
      <AlbumBrowser
        :artist="selectedGroup"
        :albums="albums"
        :selected-album="selectedAlbum"
        :tracks="tracks"
        :selected-track-id="selectedTrackId"
        :current-track-id="currentTrack?.trackId ?? null"
        :albums-loading="isLoadingAlbums"
        :albums-error="albumsError"
        :tracks-loading="isLoadingTracks"
        :tracks-error="tracksError"
        @select-album="selectAlbum"
        @select-track="selectTrack"
        @play-track="playTrackFromLibrary"
      />
    </template>

    <template #right-top>
      <TrackList :tracks="[]" title="播放队列" empty-message="播放队列为空。" />
    </template>

    <template #right-bottom>
      <TrackInfo
        :details="currentTrackDetails"
        :is-loading="isLoadingCurrentTrackDetails"
        :error="currentTrackDetailsError"
        :artwork-url="currentTrackArtworkUrl"
        :artwork-error="currentTrackArtworkError"
        empty-message="开始播放后显示当前曲目信息和封面。"
      />
    </template>
  </ResizableThreeColumnLayout>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { usePersistentLibrarySelection } from "@/composables/usePersistentLibrarySelection";
import { usePlaybackState } from "@/composables/usePlaybackState";
import { LIBRARY_SCAN_COMPLETED_EVENT } from "@/composables/useLibraryScan";
import AlbumBrowser from "@/components/library/AlbumBrowser.vue";
import GroupList from "@/components/library/GroupList.vue";
import ResizableThreeColumnLayout from "@/components/layout/ResizableThreeColumnLayout.vue";
import TrackInfo from "@/components/track/TrackInfo.vue";
import TrackList from "@/components/track/TrackList.vue";
import type { AlbumArtistSummary } from "@/types/artist";
import type { AlbumSummary } from "@/types/album";
import type { TrackArtwork, TrackDetails, TrackSummary } from "@/types/track";

const artists = ref<AlbumArtistSummary[]>([]);
const albums = ref<AlbumSummary[]>([]);
const tracks = ref<TrackSummary[]>([]);
const isLoadingArtists = ref(false);
const isLoadingAlbums = ref(false);
const isLoadingTracks = ref(false);
const artistsError = ref("");
const albumsError = ref("");
const tracksError = ref("");
const selectedTrackId = ref<number | null>(null);
const currentTrackDetails = ref<TrackDetails | null>(null);
const currentTrackArtworkUrl = ref<string | null>(null);
const isLoadingCurrentTrackDetails = ref(false);
const currentTrackDetailsError = ref("");
const currentTrackArtworkError = ref("");
const { currentTrack, playTrack } = usePlaybackState();
const {
  selectedGroup,
  selectedAlbum,
  setAvailableGroups,
  setAvailableAlbums,
  selectGroup,
  selectAlbum: setSelectedAlbum,
} = usePersistentLibrarySelection();

let isMounted = false;
let artistsRequestGeneration = 0;
let albumsRequestGeneration = 0;
let tracksRequestGeneration = 0;
let currentTrackDetailsRequestGeneration = 0;
let currentTrackArtworkRequestGeneration = 0;

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

function revokeCurrentTrackArtwork() {
  const artworkUrl = currentTrackArtworkUrl.value;
  if (artworkUrl) globalThis.URL.revokeObjectURL(artworkUrl);
  currentTrackArtworkUrl.value = null;
}

function resetSelectedTrackState(clearSelection: boolean) {
  if (clearSelection) selectedTrackId.value = null;
}

function syncCurrentTrackInfo(trackId: number | null) {
  ++currentTrackDetailsRequestGeneration;
  ++currentTrackArtworkRequestGeneration;
  currentTrackDetails.value = null;
  isLoadingCurrentTrackDetails.value = trackId !== null;
  currentTrackDetailsError.value = "";
  currentTrackArtworkError.value = "";
  revokeCurrentTrackArtwork();

  if (trackId === null) return;
  void loadCurrentTrackDetails(trackId);
  void loadCurrentTrackArtwork(trackId);
}

async function loadCurrentTrackDetails(trackId: number) {
  const generation = ++currentTrackDetailsRequestGeneration;
  isLoadingCurrentTrackDetails.value = true;
  currentTrackDetailsError.value = "";

  try {
    const result = await invoke<TrackDetails | null>("get_track", { trackId });
    if (
      generation !== currentTrackDetailsRequestGeneration ||
      currentTrack.value?.trackId !== trackId
    ) {
      return;
    }

    if (!result) {
      currentTrackDetailsError.value = "未找到正在播放曲目的详情。";
      return;
    }
    if (result.id !== trackId) {
      currentTrackDetailsError.value = "返回的曲目详情与当前播放曲目不匹配。";
      return;
    }

    currentTrackDetails.value = result;
  } catch (error) {
    if (
      generation !== currentTrackDetailsRequestGeneration ||
      currentTrack.value?.trackId !== trackId
    ) {
      return;
    }
    currentTrackDetailsError.value = `读取曲目详情失败：${errorMessage(error)}`;
  } finally {
    if (
      generation === currentTrackDetailsRequestGeneration &&
      currentTrack.value?.trackId === trackId
    ) {
      isLoadingCurrentTrackDetails.value = false;
    }
  }
}

async function loadCurrentTrackArtwork(trackId: number) {
  const generation = ++currentTrackArtworkRequestGeneration;
  revokeCurrentTrackArtwork();
  currentTrackArtworkError.value = "";

  try {
    const artwork = await invoke<TrackArtwork | null>("get_track_artwork", { trackId });
    if (
      generation !== currentTrackArtworkRequestGeneration ||
      currentTrack.value?.trackId !== trackId
    ) {
      return;
    }

    if (!artwork || artwork.status !== "available") {
      revokeCurrentTrackArtwork();
      return;
    }

    const imageBlob = new globalThis.Blob([Uint8Array.from(artwork.data)], {
      type: artwork.mimeType,
    });
    currentTrackArtworkUrl.value = globalThis.URL.createObjectURL(imageBlob);
  } catch (error) {
    if (
      generation !== currentTrackArtworkRequestGeneration ||
      currentTrack.value?.trackId !== trackId
    ) {
      return;
    }
    revokeCurrentTrackArtwork();
    currentTrackArtworkError.value = `读取封面失败，已显示占位图：${errorMessage(error)}`;
  }
}

watch(() => currentTrack.value?.trackId ?? null, syncCurrentTrackInfo, { immediate: true });

async function refreshLibrary() {
  if (!isMounted) return;

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
    if (!isMounted || generation !== artistsRequestGeneration) return;

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
    if (!isMounted || generation !== artistsRequestGeneration) return;
    artistsError.value = `读取专辑演出者失败：${errorMessage(error)}`;
    isLoadingTracks.value = false;
  } finally {
    if (isMounted && generation === artistsRequestGeneration) {
      isLoadingArtists.value = false;
    }
  }
}

async function loadAlbums(group: AlbumArtistSummary) {
  if (!isMounted || !sameGroup(selectedGroup.value, group)) return;

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
    if (!isMounted || generation !== albumsRequestGeneration) return;
    albumsError.value = `读取专辑失败：${errorMessage(error)}`;
    isLoadingTracks.value = false;
  } finally {
    if (isMounted && generation === albumsRequestGeneration) {
      isLoadingAlbums.value = false;
    }
  }
}

async function loadTracks(selection: { albumArtist: string | null; album: string | null }) {
  if (!isMounted || !sameAlbumSelection(selectedAlbum.value, selection)) return;

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
      generation !== tracksRequestGeneration ||
      !sameAlbumSelection(selectedAlbum.value, selection)
    ) {
      return;
    }
    tracksError.value = `读取曲目失败：${errorMessage(error)}`;
  } finally {
    if (isMounted && generation === tracksRequestGeneration) {
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

function playTrackFromLibrary(trackId: number) {
  if (!tracks.value.some((track) => track.id === trackId)) return;
  void playTrack(trackId);
}

function onLibraryScanCompleted() {
  void refreshLibrary();
}

onMounted(() => {
  isMounted = true;
  globalThis.window.addEventListener(LIBRARY_SCAN_COMPLETED_EVENT, onLibraryScanCompleted);
  void refreshLibrary();
});

onUnmounted(() => {
  isMounted = false;
  ++artistsRequestGeneration;
  ++albumsRequestGeneration;
  ++tracksRequestGeneration;
  resetSelectedTrackState(true);
  syncCurrentTrackInfo(null);
  globalThis.window.removeEventListener(LIBRARY_SCAN_COMPLETED_EVENT, onLibraryScanCompleted);
});
</script>

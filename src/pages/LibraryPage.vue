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
        :albums-loading="isLoadingAlbums"
        :albums-error="albumsError"
        :tracks-loading="isLoadingTracks"
        :tracks-error="tracksError"
        @select-album="selectAlbum"
        @select-track="selectTrack"
      />
    </template>

    <template #right-top>
      <TrackList
        :tracks="libraryTracks"
        title="当前专辑曲目"
        :selected-track-id="selectedTrackId"
        :current-track-id="null"
        :is-loading="isLoadingTracks"
        :error="tracksError || albumsError"
        :empty-message="selectedAlbum ? '此专辑暂无曲目。' : '展开专辑后可查看曲目。'"
        @select="selectTrackFromList"
      />
    </template>

    <template #right-bottom>
      <TrackInfo
        :details="selectedTrackDetails"
        :is-loading="isLoadingTrackDetails"
        :error="trackDetailsError"
        :artwork-url="selectedTrackArtworkUrl"
        :artwork-error="trackArtworkError"
      />
    </template>
  </ResizableThreeColumnLayout>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { usePersistentLibrarySelection } from "../composables/usePersistentLibrarySelection";
import { LIBRARY_SCAN_COMPLETED_EVENT } from "../composables/useLibraryScan";
import AlbumBrowser from "../components/library/AlbumBrowser.vue";
import GroupList from "../components/library/GroupList.vue";
import ResizableThreeColumnLayout from "../components/layout/ResizableThreeColumnLayout.vue";
import TrackInfo from "../components/track/TrackInfo.vue";
import TrackList from "../components/track/TrackList.vue";
import { formatTrackDuration } from "../components/track/formatTrackDuration.ts";
import type {
  AlbumArtistSummary,
  AlbumSummary,
  TrackArtwork,
  TrackDetails,
  TrackSummary,
} from "../types/library";

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
const selectedTrackDetails = ref<TrackDetails | null>(null);
const selectedTrackArtworkUrl = ref<string | null>(null);
const isLoadingTrackDetails = ref(false);
const trackDetailsError = ref("");
const trackArtworkError = ref("");
const libraryTracks = computed(() =>
  tracks.value.map((track) => ({
    id: track.id,
    title: track.title ?? "未知曲目",
    album: track.album ?? "未知专辑",
    duration: formatTrackDuration(track.durationMs) ?? "时长未知",
  })),
);
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
let trackDetailsRequestGeneration = 0;
let trackArtworkRequestGeneration = 0;

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

function revokeSelectedArtwork() {
  const artworkUrl = selectedTrackArtworkUrl.value;
  if (artworkUrl) globalThis.URL.revokeObjectURL(artworkUrl);
  selectedTrackArtworkUrl.value = null;
}

function resetSelectedTrackState(clearSelection: boolean) {
  ++trackDetailsRequestGeneration;
  ++trackArtworkRequestGeneration;
  if (clearSelection) selectedTrackId.value = null;

  selectedTrackDetails.value = null;
  isLoadingTrackDetails.value = !clearSelection && selectedTrackId.value !== null;
  trackDetailsError.value = "";
  trackArtworkError.value = "";
  revokeSelectedArtwork();
}

async function loadTrackDetails(trackId: number) {
  const generation = ++trackDetailsRequestGeneration;
  isLoadingTrackDetails.value = true;
  trackDetailsError.value = "";

  try {
    const result = await invoke<TrackDetails | null>("get_track", { trackId });
    if (
      !isMounted ||
      generation !== trackDetailsRequestGeneration ||
      selectedTrackId.value !== trackId
    ) {
      return;
    }

    if (!result) {
      resetSelectedTrackState(true);
      trackDetailsError.value = "未找到所选曲目的详情。";
      return;
    }
    if (result.id !== trackId) {
      resetSelectedTrackState(true);
      trackDetailsError.value = "返回的曲目详情与当前选择不匹配。";
      return;
    }

    selectedTrackDetails.value = result;
  } catch (error) {
    if (
      !isMounted ||
      generation !== trackDetailsRequestGeneration ||
      selectedTrackId.value !== trackId
    ) {
      return;
    }
    trackDetailsError.value = `读取曲目详情失败：${errorMessage(error)}`;
  } finally {
    if (
      isMounted &&
      generation === trackDetailsRequestGeneration &&
      selectedTrackId.value === trackId
    ) {
      isLoadingTrackDetails.value = false;
    }
  }
}

async function loadTrackArtwork(trackId: number) {
  const generation = ++trackArtworkRequestGeneration;
  revokeSelectedArtwork();
  trackArtworkError.value = "";

  try {
    const artwork = await invoke<TrackArtwork | null>("get_track_artwork", { trackId });
    if (
      !isMounted ||
      generation !== trackArtworkRequestGeneration ||
      selectedTrackId.value !== trackId
    ) {
      return;
    }

    if (!artwork || artwork.status !== "available") {
      revokeSelectedArtwork();
      return;
    }

    const imageBlob = new globalThis.Blob([Uint8Array.from(artwork.data)], {
      type: artwork.mimeType,
    });
    selectedTrackArtworkUrl.value = globalThis.URL.createObjectURL(imageBlob);
  } catch (error) {
    if (
      !isMounted ||
      generation !== trackArtworkRequestGeneration ||
      selectedTrackId.value !== trackId
    ) {
      return;
    }
    revokeSelectedArtwork();
    trackArtworkError.value = `读取封面失败，已显示占位图：${errorMessage(error)}`;
  }
}

async function refreshLibrary() {
  if (!isMounted) return;

  resetSelectedTrackState(false);
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
    if (selectedTrackId.value !== null) {
      isLoadingTrackDetails.value = false;
      trackDetailsError.value = `刷新曲目列表失败：${errorMessage(error)}`;
    }
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
  resetSelectedTrackState(false);
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
    if (selectedTrackId.value !== null) {
      isLoadingTrackDetails.value = false;
      trackDetailsError.value = `刷新曲目详情失败：${errorMessage(error)}`;
    }
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
      if (result.some((track) => track.id === trackId)) {
        void loadTrackDetails(trackId);
        void loadTrackArtwork(trackId);
      } else {
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
    if (selectedTrackId.value !== null) {
      isLoadingTrackDetails.value = false;
      trackDetailsError.value = `刷新曲目详情失败：${errorMessage(error)}`;
    }
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
  void loadTrackDetails(trackId);
  void loadTrackArtwork(trackId);
}

function selectTrackFromList(trackId: string | number) {
  if (typeof trackId === "number") selectTrack(trackId);
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
  globalThis.window.removeEventListener(LIBRARY_SCAN_COMPLETED_EVENT, onLibraryScanCompleted);
});
</script>

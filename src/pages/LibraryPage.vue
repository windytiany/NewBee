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
        :albums-loading="isLoadingAlbums"
        :albums-error="albumsError"
        :tracks-loading="isLoadingTracks"
        :tracks-error="tracksError"
        @select-album="selectAlbum"
      />
    </template>

    <template #right-top>
      <TrackList />
    </template>

    <template #right-bottom>
      <TrackInfo />
    </template>
  </ResizableThreeColumnLayout>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref } from "vue";
import { usePersistentLibrarySelection } from "../composables/usePersistentLibrarySelection";
import { LIBRARY_SCAN_COMPLETED_EVENT } from "../composables/useLibraryScan";
import AlbumBrowser from "../components/library/AlbumBrowser.vue";
import GroupList from "../components/library/GroupList.vue";
import ResizableThreeColumnLayout from "../components/layout/ResizableThreeColumnLayout.vue";
import TrackInfo from "../components/track/TrackInfo.vue";
import TrackList from "../components/track/TrackList.vue";
import type { AlbumArtistSummary, AlbumSummary, TrackSummary } from "../types/library";

const artists = ref<AlbumArtistSummary[]>([]);
const albums = ref<AlbumSummary[]>([]);
const tracks = ref<TrackSummary[]>([]);
const isLoadingArtists = ref(false);
const isLoadingAlbums = ref(false);
const isLoadingTracks = ref(false);
const artistsError = ref("");
const albumsError = ref("");
const tracksError = ref("");
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

async function refreshLibrary() {
  if (!isMounted) return;

  const generation = ++artistsRequestGeneration;
  ++albumsRequestGeneration;
  ++tracksRequestGeneration;
  isLoadingAlbums.value = false;
  isLoadingTracks.value = false;
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
    }
  } catch (error) {
    if (!isMounted || generation !== artistsRequestGeneration) return;
    artistsError.value = `读取专辑演出者失败：${errorMessage(error)}`;
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
  isLoadingTracks.value = false;
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
    }
  } catch (error) {
    if (!isMounted || generation !== albumsRequestGeneration) return;
    albumsError.value = `读取专辑失败：${errorMessage(error)}`;
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
  globalThis.window.removeEventListener(LIBRARY_SCAN_COMPLETED_EVENT, onLibraryScanCompleted);
});
</script>

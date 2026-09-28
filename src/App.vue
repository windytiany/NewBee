<script setup lang="ts">
import { computed, ref } from "vue";
import { usePersistentActivePage } from "@/composables/usePersistentActivePage";
import { useLibraryPage } from "@/composables/useLibraryPage";
import { usePlaylistPage } from "@/composables/usePlaylistPage";
import PlayingPage from "@/pages/PlayingPage.vue";
import PlaybackBar from "@/components/PlaybackBar.vue";
import AlbumBrowser from "@/components/library/AlbumBrowser.vue";
import GroupList from "@/components/library/GroupList.vue";
import CreatePlaylistDialog from "@/components/playlist/CreatePlaylistDialog.vue";
import PlaylistBrowser from "@/components/playlist/PlaylistBrowser.vue";
import PlaylistList from "@/components/playlist/PlaylistList.vue";
import PlaybackWorkspaceLayout from "@/components/layout/PlaybackWorkspaceLayout.vue";
import TopBar from "@/components/TopBar.vue";

const { activePage } = usePersistentActivePage();
const libraryActive = computed(() => activePage.value === "Library");
const {
  artists,
  albums,
  tracks,
  isLoadingArtists,
  isLoadingAlbums,
  isLoadingTracks,
  artistsError,
  albumsError,
  tracksError,
  selectedTrackId,
  currentTrack,
  selectedGroup,
  selectedAlbum,
  selectArtist,
  selectAlbum,
  selectTrack,
  playTrackFromLibrary,
} = useLibraryPage(libraryActive);
const playlistActive = computed(() => activePage.value === "Playlist");
const {
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
} = usePlaylistPage(playlistActive);
const createPlaylistDialog = ref<InstanceType<typeof CreatePlaylistDialog> | null>(null);

function showCreatePlaylistDialog() {
  createPlaylistDialog.value?.show();
}

function onPlaylistCreated(playlistId: number) {
  void refreshPlaylists(playlistId);
}
</script>

<template>
  <div class="bg-spotify-base min-h-screen font-sans text-white">
    <TopBar v-model:active-page="activePage" />
    <main class="grid min-h-screen place-items-center pt-14 pb-20 sm:pb-10">
      <PlaybackWorkspaceLayout :mode="activePage === 'Playing' ? 'playing' : 'workspace'">
        <template #left>
          <GroupList
            v-if="activePage === 'Library'"
            :artists="artists"
            :selected-artist="selectedGroup"
            :is-loading="isLoadingArtists"
            :error="artistsError"
            @select="selectArtist"
          />
          <PlaylistList
            v-else-if="activePage === 'Playlist'"
            :playlists="playlists"
            :selected-playlist-id="selectedPlaylistId"
            :is-loading="isLoadingPlaylists"
            :error="playlistsError"
            @select="selectPlaylist"
            @create="showCreatePlaylistDialog"
          />
        </template>
        <template #center>
          <AlbumBrowser
            v-if="activePage === 'Library'"
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
          <PlaylistBrowser
            v-else-if="activePage === 'Playlist'"
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
        <template #playing>
          <PlayingPage v-if="activePage === 'Playing'" />
        </template>
      </PlaybackWorkspaceLayout>
    </main>
    <CreatePlaylistDialog
      v-if="activePage === 'Playlist'"
      ref="createPlaylistDialog"
      @created="onPlaylistCreated"
    />
    <PlaybackBar />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { usePersistentActivePage } from "@/navigation/activePage";
import { useLibraryPage } from "@/library/usePage";
import { usePlaylistPage } from "@/playlist/usePage";
import PlayingPage from "@/playing/PlayingPage.vue";
import PlaybackBar from "@/playback/ui/PlaybackBar.vue";
import AlbumBrowser from "@/library/ui/AlbumBrowser.vue";
import DeleteTrackDialog from "@/library/ui/DeleteTrackDialog.vue";
import ArtistList from "@/library/ui/ArtistList.vue";
import CreatePlaylistDialog from "@/playlist/ui/CreatePlaylistDialog.vue";
import PlaylistBrowser from "@/playlist/ui/PlaylistBrowser.vue";
import PlaylistList from "@/playlist/ui/PlaylistList.vue";
import WorkspaceLayout from "@/layout/WorkspaceLayout.vue";
import TopBar from "@/navigation/TopBar.vue";
import type { TrackSummary } from "@/types/track";

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
  isTrackActionPending,
  trackActionError,
  trackActionMessage,
  currentTrack,
  activeQueueRowKey,
  selectedGroup,
  selectedAlbum,
  selectArtist,
  selectAlbum,
  playTrackFromLibrary,
  playAlbumFromLibrary,
  addTracksToNext,
  addTracksToQueueEnd,
  addTracksToPlaylist,
  removeTrackFromLibrary,
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
  isPlaylistActionPending,
  playlistActionError,
  playlistActionMessage,
  coverTrackId,
  isCoverPending,
  selectPlaylist,
  playTrackFromPlaylist,
  playPlaylistFromPage,
  addPlaylistItemsToNext,
  addPlaylistItemsToQueueEnd,
  removePlaylistItems,
  reorderPlaylistItems,
  refreshPlaylists,
} = usePlaylistPage(playlistActive);
const createPlaylistDialog = ref<InstanceType<typeof CreatePlaylistDialog> | null>(null);
const deleteTrackDialog = ref<InstanceType<typeof DeleteTrackDialog> | null>(null);
const deleteTrackTarget = ref<TrackSummary | null>(null);
const deleteTrackDialogError = ref("");

function showCreatePlaylistDialog() {
  createPlaylistDialog.value?.show();
}

function onPlaylistCreated(playlistId: number) {
  void refreshPlaylists(playlistId);
}

function refreshPlaylistsForTrackMenu() {
  void refreshPlaylists(undefined, true);
}

async function addTracksToExistingPlaylist(trackIds: number[], playlistId: number) {
  const result = await addTracksToPlaylist(trackIds, playlistId);
  if (result.successfulTrackIds.length > 0) await refreshPlaylists(undefined, true);
}

function requestTrackDeletion(trackId: number) {
  const track = tracks.value.find((entry) => entry.id === trackId);
  if (!track) return;

  deleteTrackTarget.value = track;
  deleteTrackDialogError.value = "";
  void nextTick(() => deleteTrackDialog.value?.show());
}

function cancelTrackDeletion() {
  deleteTrackTarget.value = null;
  deleteTrackDialogError.value = "";
}

async function confirmTrackDeletion(trackId: number) {
  if (deleteTrackTarget.value?.id !== trackId) return;

  const result = await removeTrackFromLibrary(trackId);
  if (result.status === "not-deleted") {
    deleteTrackDialogError.value = result.message;
    return;
  }

  deleteTrackDialog.value?.close();
  deleteTrackTarget.value = null;
  deleteTrackDialogError.value = "";
  await refreshPlaylists(undefined, true);
}
</script>

<template>
  <div class="bg-spotify-base min-h-screen font-sans text-white">
    <TopBar v-model:active-page="activePage" />
    <main class="grid min-h-screen place-items-center pt-14 pb-20 sm:pb-10">
      <WorkspaceLayout :mode="activePage === 'Playing' ? 'playing' : 'workspace'">
        <template #left>
          <ArtistList
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
            :current-track-id="currentTrack?.trackId ?? null"
            :albums-loading="isLoadingAlbums"
            :albums-error="albumsError"
            :tracks-loading="isLoadingTracks"
            :tracks-error="tracksError"
            :playlists="playlists"
            :playlists-loading="isLoadingPlaylists"
            :playlists-error="playlistsError"
            :track-action-pending="isTrackActionPending"
            :track-action-error="trackActionError"
            :track-action-message="trackActionMessage"
            @select-album="selectAlbum"
            @play-track="playTrackFromLibrary"
            @play-album="playAlbumFromLibrary"
            @refresh-playlists="refreshPlaylistsForTrackMenu"
            @add-tracks-to-next="addTracksToNext"
            @add-tracks-to-queue-end="addTracksToQueueEnd"
            @add-tracks-to-playlist="addTracksToExistingPlaylist"
            @delete-track="requestTrackDeletion"
          />
          <PlaylistBrowser
            v-else-if="activePage === 'Playlist'"
            :playlist="selectedPlaylist"
            :cover-track-id="coverTrackId"
            :is-cover-pending="isCoverPending"
            :tracks="playlistTracks"
            :current-row-key="activeQueueRowKey"
            :is-loading-playlists="isLoadingPlaylists"
            :playlists-error="playlistsError"
            :has-playlists="playlists.length > 0"
            :is-loading-tracks="isLoadingPlaylistTracks"
            :tracks-error="playlistTracksError"
            :is-playlist-action-pending="isPlaylistActionPending"
            :playlist-action-error="playlistActionError"
            :playlist-action-message="playlistActionMessage"
            @play-track="playTrackFromPlaylist"
            @play-playlist="playPlaylistFromPage"
            @add-playlist-items-to-next="addPlaylistItemsToNext"
            @add-playlist-items-to-queue-end="addPlaylistItemsToQueueEnd"
            @remove-playlist-items="removePlaylistItems"
            @reorder-playlist-items="reorderPlaylistItems"
          />
        </template>
        <template #playing>
          <PlayingPage v-if="activePage === 'Playing'" />
        </template>
      </WorkspaceLayout>
    </main>
    <CreatePlaylistDialog
      v-if="activePage === 'Playlist'"
      ref="createPlaylistDialog"
      @created="onPlaylistCreated"
    />
    <DeleteTrackDialog
      v-if="deleteTrackTarget"
      ref="deleteTrackDialog"
      :track="deleteTrackTarget"
      :is-deleting="isTrackActionPending"
      :error="deleteTrackDialogError"
      @confirm="confirmTrackDeletion"
      @cancel="cancelTrackDeletion"
    />
    <PlaybackBar />
  </div>
</template>

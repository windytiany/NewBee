<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { usePersistentActivePage } from "@/navigation/activePage";
import { useLibraryPage } from "@/library/usePage";
import { usePlaylistPage } from "@/playlist/usePage";
import PlayingPage from "@/playing/PlayingPage.vue";
import PlaybackBar from "@/playback/ui/PlaybackBar.vue";
import AlbumBrowser from "@/library/ui/AlbumBrowser.vue";
import DeleteTrackDialog from "@/library/ui/DeleteTrackDialog.vue";
import ArtistList from "@/library/ui/ArtistList.vue";
import CreatePlaylistDialog from "@/playlist/ui/CreatePlaylistDialog.vue";
import DeletePlaylistDialog from "@/playlist/ui/DeletePlaylistDialog.vue";
import PlaylistBrowser from "@/playlist/ui/PlaylistBrowser.vue";
import PlaylistList from "@/playlist/ui/PlaylistList.vue";
import RenamePlaylistDialog from "@/playlist/ui/RenamePlaylistDialog.vue";
import WorkspaceLayout from "@/layout/WorkspaceLayout.vue";
import TopBar from "@/navigation/TopBar.vue";
import type { TrackSummary } from "@/types/track";

type PlaylistManagementDialog = "rename" | "delete";

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
  pendingPlaylistIds,
  playlistsError,
  playlistTracksError,
  isPlaylistActionPending,
  playlistActionError,
  dismissPlaylistActionError,
  coverTrackId,
  isCoverPending,
  selectPlaylist,
  renamePlaylist,
  deletePlaylist,
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
const playlistList = ref<InstanceType<typeof PlaylistList> | null>(null);
const renamePlaylistDialog = ref<InstanceType<typeof RenamePlaylistDialog> | null>(null);
const deletePlaylistDialog = ref<InstanceType<typeof DeletePlaylistDialog> | null>(null);
const deleteTrackTarget = ref<TrackSummary | null>(null);
const deleteTrackDialogError = ref("");
const managementPlaylistId = ref<number | null>(null);
const managementDialogType = ref<PlaylistManagementDialog | null>(null);
const managementOriginalIndex = ref<number | null>(null);
const managementDialogError = ref("");
const managementPlaylist = computed(() => {
  const playlistId = managementPlaylistId.value;
  return playlistId === null
    ? null
    : (playlists.value.find((playlist) => playlist.id === playlistId) ?? null);
});
const managementPlaylistPending = computed(() => {
  const playlistId = managementPlaylistId.value;
  return playlistId !== null && pendingPlaylistIds.value.includes(playlistId);
});
let playlistManagementRequestSequence = 0;
let activePlaylistManagementRequestId = 0;

function showCreatePlaylistDialog() {
  createPlaylistDialog.value?.show();
}

function closePlaylistManagementDialog() {
  if (managementDialogType.value === "rename") renamePlaylistDialog.value?.close();
  if (managementDialogType.value === "delete") deletePlaylistDialog.value?.close();
}

function resetPlaylistManagement() {
  closePlaylistManagementDialog();
  activePlaylistManagementRequestId = ++playlistManagementRequestSequence;
  managementPlaylistId.value = null;
  managementDialogType.value = null;
  managementOriginalIndex.value = null;
  managementDialogError.value = "";
}

function isCurrentPlaylistManagementRequest(
  playlistId: number,
  dialogType: PlaylistManagementDialog,
  requestId: number,
) {
  return (
    activePlaylistManagementRequestId === requestId &&
    managementPlaylistId.value === playlistId &&
    managementDialogType.value === dialogType &&
    activePage.value === "Playlist"
  );
}

function requestPlaylistManagement(dialogType: PlaylistManagementDialog, playlistId: number) {
  if (activePage.value !== "Playlist") return;

  const originalIndex = playlists.value.findIndex((playlist) => playlist.id === playlistId);
  if (originalIndex < 0 || pendingPlaylistIds.value.includes(playlistId)) return;

  const requestId = ++playlistManagementRequestSequence;
  activePlaylistManagementRequestId = requestId;
  managementPlaylistId.value = playlistId;
  managementDialogType.value = dialogType;
  managementOriginalIndex.value = originalIndex;
  managementDialogError.value = "";

  void nextTick(() => {
    if (!isCurrentPlaylistManagementRequest(playlistId, dialogType, requestId)) return;
    if (pendingPlaylistIds.value.includes(playlistId)) {
      cancelPlaylistManagement();
      return;
    }

    if (dialogType === "rename") renamePlaylistDialog.value?.show();
    else deletePlaylistDialog.value?.show();
  });
}

function requestPlaylistRename(playlistId: number) {
  requestPlaylistManagement("rename", playlistId);
}

function requestPlaylistDeletion(playlistId: number) {
  requestPlaylistManagement("delete", playlistId);
}

async function focusAfterPlaylistDeletion(originalIndex: number) {
  await nextTick();
  if (activePage.value !== "Playlist") return;
  await playlistList.value?.focusAfterDeletion(originalIndex);
}

async function restorePlaylistManagementFocus(playlistId: number, originalIndex: number) {
  await nextTick();
  if (activePage.value !== "Playlist") return;

  if (playlists.value.some((playlist) => playlist.id === playlistId)) {
    await playlistList.value?.focusPlaylist(playlistId);
  } else {
    await playlistList.value?.focusAfterDeletion(originalIndex);
  }
}

function cancelPlaylistManagement() {
  const playlistId = managementPlaylistId.value;
  const originalIndex = managementOriginalIndex.value;
  resetPlaylistManagement();

  if (playlistId !== null && originalIndex !== null) {
    void restorePlaylistManagementFocus(playlistId, originalIndex);
  }
}

async function confirmPlaylistRename(playlistId: number, name: string) {
  if (!isCurrentPlaylistManagementRequest(playlistId, "rename", activePlaylistManagementRequestId))
    return;
  if (pendingPlaylistIds.value.includes(playlistId)) return;

  const requestId = ++playlistManagementRequestSequence;
  activePlaylistManagementRequestId = requestId;
  const originalIndex = managementOriginalIndex.value ?? 0;
  const result = await renamePlaylist(playlistId, name);
  if (!isCurrentPlaylistManagementRequest(playlistId, "rename", requestId)) return;

  if (result.status === "error") {
    managementDialogError.value = result.message;
    return;
  }

  resetPlaylistManagement();
  void restorePlaylistManagementFocus(playlistId, originalIndex);
}

async function confirmPlaylistDeletion(playlistId: number) {
  if (!isCurrentPlaylistManagementRequest(playlistId, "delete", activePlaylistManagementRequestId))
    return;
  if (pendingPlaylistIds.value.includes(playlistId)) return;

  const originalIndex = managementOriginalIndex.value;
  if (originalIndex === null) return;

  const requestId = ++playlistManagementRequestSequence;
  activePlaylistManagementRequestId = requestId;
  const result = await deletePlaylist(playlistId);
  if (!isCurrentPlaylistManagementRequest(playlistId, "delete", requestId)) return;

  if (result.status === "error") {
    managementDialogError.value = result.message;
    return;
  }

  resetPlaylistManagement();
  await focusAfterPlaylistDeletion(originalIndex);
}

watch(managementPlaylist, (playlist) => {
  if (playlist || managementPlaylistId.value === null) return;

  const originalIndex = managementOriginalIndex.value;
  resetPlaylistManagement();
  if (originalIndex !== null) void focusAfterPlaylistDeletion(originalIndex);
});

watch(activePage, (page) => {
  if (page !== "Playlist" && managementPlaylistId.value !== null) {
    resetPlaylistManagement();
  }
});

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
            ref="playlistList"
            :playlists="playlists"
            :selected-playlist-id="selectedPlaylistId"
            :is-loading="isLoadingPlaylists"
            :error="playlistsError"
            :pending-playlist-ids="pendingPlaylistIds"
            @select="selectPlaylist"
            @create="showCreatePlaylistDialog"
            @rename="requestPlaylistRename"
            @delete="requestPlaylistDeletion"
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
            @play-track="playTrackFromPlaylist"
            @play-playlist="playPlaylistFromPage"
            @add-playlist-items-to-next="addPlaylistItemsToNext"
            @add-playlist-items-to-queue-end="addPlaylistItemsToQueueEnd"
            @remove-playlist-items="removePlaylistItems"
            @reorder-playlist-items="reorderPlaylistItems"
            @dismiss-playlist-action-error="dismissPlaylistActionError"
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
    <RenamePlaylistDialog
      v-if="managementDialogType === 'rename' && managementPlaylist"
      ref="renamePlaylistDialog"
      :playlist="managementPlaylist"
      :is-pending="managementPlaylistPending"
      :error="managementDialogError"
      @confirm="confirmPlaylistRename"
      @cancel="cancelPlaylistManagement"
    />
    <DeletePlaylistDialog
      v-if="managementDialogType === 'delete' && managementPlaylist"
      ref="deletePlaylistDialog"
      :playlist="managementPlaylist"
      :is-pending="managementPlaylistPending"
      :error="managementDialogError"
      @confirm="confirmPlaylistDeletion"
      @cancel="cancelPlaylistManagement"
    />
    <PlaybackBar />
  </div>
</template>

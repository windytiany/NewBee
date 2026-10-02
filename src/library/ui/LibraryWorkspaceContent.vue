<script setup lang="ts">
import AlbumBrowser from "@/library/ui/AlbumBrowser.vue";
import type { LibraryWorkspace } from "@/library/useLibraryWorkspace";

defineProps<{ workspace: LibraryWorkspace }>();
</script>

<template>
  <AlbumBrowser
    :artist="workspace.page.selectedGroup"
    :albums="workspace.page.albums"
    :selected-album="workspace.page.selectedAlbum"
    :tracks="workspace.page.tracks"
    :current-track-id="workspace.page.currentTrack?.trackId ?? null"
    :albums-loading="workspace.page.isLoadingAlbums"
    :albums-error="workspace.page.albumsError"
    :tracks-loading="workspace.page.isLoadingTracks"
    :tracks-error="workspace.page.tracksError"
    :playlists="workspace.playlists.playlists"
    :playlists-loading="workspace.playlists.isLoadingPlaylists"
    :playlists-error="workspace.playlists.playlistsError"
    :track-action-pending="workspace.page.isTrackActionPending"
    @select-album="workspace.page.selectAlbum"
    @play-track="workspace.page.playTrackFromLibrary"
    @play-album="workspace.page.playAlbumFromLibrary"
    @refresh-playlists="workspace.refreshPlaylists"
    @add-tracks-to-next="workspace.page.addTracksToNext"
    @add-tracks-to-queue-end="workspace.page.addTracksToQueueEnd"
    @add-tracks-to-playlist="workspace.addTracksToExistingPlaylist"
    @delete-track="workspace.requestTrackDeletion"
    @add-album-to-next="workspace.page.addAlbumToNext"
    @add-album-to-queue-end="workspace.page.addAlbumToQueueEnd"
    @add-album-to-playlist="workspace.addAlbumToExistingPlaylist"
    @delete-album="workspace.requestAlbumDeletion"
  />
</template>

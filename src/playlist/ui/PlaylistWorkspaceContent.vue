<script setup lang="ts">
import PlaylistBrowser from "@/playlist/ui/PlaylistBrowser.vue";
import type { PlaylistWorkspace } from "@/playlist/usePlaylistWorkspace";

defineProps<{ workspace: PlaylistWorkspace }>();
</script>

<template>
  <PlaylistBrowser
    :playlist="workspace.page.selectedPlaylist"
    :cover-track-id="workspace.page.coverTrackId"
    :is-cover-pending="workspace.page.isCoverPending"
    :tracks="workspace.page.playlistTracks"
    :current-row-key="workspace.activeQueueRowKey"
    :is-loading-playlists="workspace.page.isLoadingPlaylists"
    :playlists-error="workspace.page.playlistsError"
    :has-playlists="workspace.page.playlists.length > 0"
    :is-loading-tracks="workspace.page.isLoadingPlaylistTracks"
    :tracks-error="workspace.page.playlistTracksError"
    :is-playlist-action-pending="workspace.page.isPlaylistActionPending"
    :playlist-action-error="workspace.page.playlistActionError"
    @play-track="workspace.page.playTrackFromPlaylist"
    @play-playlist="workspace.page.playPlaylistFromPage"
    @add-playlist-items-to-next="workspace.page.addPlaylistItemsToNext"
    @add-playlist-items-to-queue-end="workspace.page.addPlaylistItemsToQueueEnd"
    @remove-playlist-items="workspace.page.removePlaylistItems"
    @reorder-playlist-items="workspace.page.reorderPlaylistItems"
  />
</template>

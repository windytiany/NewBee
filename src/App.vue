<script setup lang="ts">
import { computed } from "vue";
import { usePersistentActivePage } from "@/navigation/activePage";
import { useLibraryWorkspace } from "@/library/useLibraryWorkspace";
import { usePlaylistWorkspace } from "@/playlist/usePlaylistWorkspace";
import ArtistList from "@/library/ui/ArtistList.vue";
import LibraryWorkspaceContent from "@/library/ui/LibraryWorkspaceContent.vue";
import LibraryWorkspaceDialogs from "@/library/ui/LibraryWorkspaceDialogs.vue";
import PlaylistList from "@/playlist/ui/PlaylistList.vue";
import PlaylistWorkspaceContent from "@/playlist/ui/PlaylistWorkspaceContent.vue";
import PlaylistWorkspaceDialogs from "@/playlist/ui/PlaylistWorkspaceDialogs.vue";
import PlayingPage from "@/playing/ui/PlayingPage.vue";
import PlaybackBar from "@/playback/ui/PlaybackBar.vue";
import NotificationHost from "@/notification/ui/NotificationHost.vue";
import MetadataEditorDialog from "@/metadata/ui/MetadataEditorDialog.vue";
import AlbumTagDialog from "@/albumTags/ui/AlbumTagDialog.vue";
import WorkspaceLayout from "@/layout/WorkspaceLayout.vue";
import TopBar from "@/navigation/TopBar.vue";

const { activePage } = usePersistentActivePage();
const libraryActive = computed(() => activePage.value === "Library");
const playlistActive = computed(() => activePage.value === "Playlist");
const playlist = usePlaylistWorkspace(playlistActive);
const library = useLibraryWorkspace(libraryActive, {
  playlists: playlist.page,
  refreshPlaylists: () => playlist.page.refreshPlaylists(undefined, true),
});
</script>

<template>
  <div class="bg-spotify-base min-h-screen font-sans text-white">
    <TopBar v-model:active-page="activePage" />
    <main class="grid min-h-screen place-items-center pt-14 pb-20 sm:pb-10">
      <WorkspaceLayout :mode="activePage === 'Playing' ? 'playing' : 'workspace'">
        <template #left>
          <ArtistList
            v-if="libraryActive"
            :artists="library.page.artists"
            :selected-artist="library.page.selectedGroup"
            :is-loading="library.page.isLoadingArtists"
            :error="library.page.artistsError"
            @select="library.page.selectArtist"
          />
          <PlaylistList
            v-else-if="playlistActive"
            :ref="playlist.elements.playlistList"
            :playlists="playlist.page.playlists"
            :selected-playlist-id="playlist.page.selectedPlaylistId"
            :is-loading="playlist.page.isLoadingPlaylists"
            :error="playlist.page.playlistsError"
            :pending-playlist-ids="playlist.page.pendingPlaylistIds"
            @select="playlist.page.selectPlaylist"
            @create="playlist.showCreatePlaylistDialog"
            @rename="playlist.requestPlaylistRename"
            @delete="playlist.requestPlaylistDeletion"
          />
        </template>
        <template #center>
          <LibraryWorkspaceContent v-if="libraryActive" :workspace="library" />
          <PlaylistWorkspaceContent v-else-if="playlistActive" :workspace="playlist" />
        </template>
        <template #playing>
          <PlayingPage v-if="activePage === 'Playing'" />
        </template>
      </WorkspaceLayout>
    </main>
    <LibraryWorkspaceDialogs :workspace="library" />
    <PlaylistWorkspaceDialogs :workspace="playlist" :active="playlistActive" />
    <PlaybackBar />
    <MetadataEditorDialog />
    <AlbumTagDialog />
    <NotificationHost />
  </div>
</template>

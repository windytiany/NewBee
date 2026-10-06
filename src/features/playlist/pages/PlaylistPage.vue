<script setup lang="ts">
import { toRef } from "vue";
import { usePlaylist } from "@/features/playlist/composables/usePlaylist";
import type { PlaylistCatalog } from "@/features/playlist/types";
import SidePane from "@/shared/components/SidePane.vue";
import PlaylistList from "@/features/playlist/components/list/PlaylistList.vue";
import PlaylistBrowser from "@/features/playlist/components/tracks/PlaylistBrowser.vue";
import CreatePlaylistDialog from "@/features/playlist/components/dialogs/CreatePlaylistDialog.vue";
import DeletePlaylistDialog from "@/features/playlist/components/dialogs/DeletePlaylistDialog.vue";
import RenamePlaylistDialog from "@/features/playlist/components/dialogs/RenamePlaylistDialog.vue";

const props = defineProps<{ active: boolean }>();
const emit = defineEmits<{ "catalog-ready": [catalog: PlaylistCatalog] }>();
const playlist = usePlaylist(toRef(props, "active"));
emit("catalog-ready", {
  get playlists() {
    return playlist.page.playlists;
  },
  get isLoadingPlaylists() {
    return playlist.page.isLoadingPlaylists;
  },
  get playlistsError() {
    return playlist.page.playlistsError;
  },
  refresh: () => playlist.page.refreshPlaylists(undefined, true),
});
</script>

<template>
  <div v-show="active" class="contents">
    <SidePane side="left" class="col-start-1 row-start-1 max-md:hidden">
      <PlaylistList
        :ref="playlist.elements.playlistList"
        :playlists="playlist.page.playlists"
        :selected-playlist-id="playlist.page.selectedPlaylistId"
        :is-loading="playlist.page.isLoadingPlaylists"
        :error="playlist.page.playlistsError"
        :pending-playlist-ids="playlist.page.pendingPlaylistIds"
        @retry="() => playlist.page.refreshPlaylists(undefined, true)"
        @select="playlist.page.selectPlaylist"
        @create="playlist.showCreatePlaylistDialog"
        @rename="playlist.requestPlaylistRename"
        @delete="playlist.requestPlaylistDeletion"
      />
    </SidePane>
    <section
      class="col-start-1 row-start-1 grid h-full min-h-0 min-w-0 place-items-center overflow-hidden text-white md:col-start-3"
    >
      <PlaylistBrowser
        :playlist="playlist.page.selectedPlaylist"
        :cover-track-id="playlist.page.coverTrackId"
        :is-cover-pending="playlist.page.isCoverPending"
        :tracks="playlist.page.playlistTracks"
        :current-row-key="playlist.activeQueueRowKey"
        :is-loading-playlists="playlist.page.isLoadingPlaylists"
        :playlists-error="playlist.page.playlistsError"
        :has-playlists="playlist.page.playlists.length > 0"
        :is-loading-tracks="playlist.page.isLoadingPlaylistTracks"
        :tracks-error="playlist.page.playlistTracksError"
        :is-playlist-action-pending="playlist.page.isPlaylistActionPending"
        :playlist-action-error="playlist.page.playlistActionError"
        @retry="() => playlist.page.refreshPlaylists(undefined, true)"
        @play-track="playlist.page.playTrackFromPlaylist"
        @play-playlist="playlist.page.playPlaylistFromPage"
        @add-playlist-items-to-next="playlist.page.addPlaylistItemsToNext"
        @add-playlist-items-to-queue-end="playlist.page.addPlaylistItemsToQueueEnd"
        @remove-playlist-items="playlist.page.removePlaylistItems"
        @reorder-playlist-items="playlist.page.reorderPlaylistItems"
      />
    </section>
  </div>
  <CreatePlaylistDialog
    v-if="active"
    :ref="playlist.elements.createPlaylistDialog"
    @created="playlist.onPlaylistCreated"
  />
  <RenamePlaylistDialog
    v-if="playlist.managementDialogType === 'rename' && playlist.managementPlaylist"
    :ref="playlist.elements.renamePlaylistDialog"
    :playlist="playlist.managementPlaylist"
    :error="playlist.managementError"
    :is-pending="playlist.managementPlaylistPending"
    @confirm="playlist.confirmPlaylistRename"
    @cancel="playlist.cancelPlaylistManagement"
  />
  <DeletePlaylistDialog
    v-if="playlist.managementDialogType === 'delete' && playlist.managementPlaylist"
    :ref="playlist.elements.deletePlaylistDialog"
    :playlist="playlist.managementPlaylist"
    :error="playlist.managementError"
    :is-pending="playlist.managementPlaylistPending"
    @confirm="playlist.confirmPlaylistDeletion"
    @cancel="playlist.cancelPlaylistManagement"
  />
</template>

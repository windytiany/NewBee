<script setup lang="ts">
import { toRef } from "vue";
import { useLibrary } from "@/features/library/composables/useLibrary";
import type { PlaylistCatalog } from "@/features/playlist/types";
import SidePane from "@/shared/components/SidePane.vue";
import ArtistList from "@/features/artists/navigation/ArtistList.vue";
import AlbumBrowser from "@/features/library/browser/albums/AlbumBrowser.vue";
import DeleteAlbumDialog from "@/features/library/components/dialogs/DeleteAlbumDialog.vue";
import DeleteTrackDialog from "@/features/library/components/dialogs/DeleteTrackDialog.vue";

const props = defineProps<{ active: boolean; catalog: PlaylistCatalog | null }>();
const library = useLibrary(toRef(props, "active"), {
  playlists: {
    get playlists() {
      return props.catalog?.playlists ?? [];
    },
    get isLoadingPlaylists() {
      return props.catalog?.isLoadingPlaylists ?? false;
    },
    get playlistsError() {
      return props.catalog?.playlistsError ?? "";
    },
  },
  refreshPlaylists: () => props.catalog?.refresh() ?? Promise.resolve(),
});
</script>

<template>
  <div v-show="active" class="contents">
    <SidePane side="left" class="col-start-1 row-start-1 max-md:hidden">
      <ArtistList
        :artists="library.page.artists"
        :grouping="library.page.grouping"
        :selected-artist="library.page.selectedGroup"
        :is-loading="library.page.isLoadingArtists"
        :error="library.page.artistsError"
        @select="library.page.selectArtist"
        @select-grouping="library.page.selectGrouping"
      />
    </SidePane>
    <section
      class="col-start-1 row-start-1 grid h-full min-h-0 min-w-0 place-items-center overflow-hidden text-white md:col-start-3"
    >
      <AlbumBrowser
        :artist="library.page.selectedGroup"
        :grouping="library.page.grouping"
        :albums="library.page.albums"
        :selected-album="library.page.selectedAlbum"
        :tracks="library.page.tracks"
        :current-track-id="library.page.currentTrack?.trackId ?? null"
        :is-playing="library.page.playbackStatus.isPlaying"
        :playback-command-pending="library.page.isPlaybackCommandPending"
        :albums-loading="library.page.isLoadingAlbums"
        :albums-error="library.page.albumsError"
        :tracks-loading="library.page.isLoadingTracks"
        :tracks-error="library.page.tracksError"
        :playlists="library.playlists.playlists"
        :playlists-loading="library.playlists.isLoadingPlaylists"
        :playlists-error="library.playlists.playlistsError"
        :track-action-pending="library.page.isTrackActionPending"
        @select-album="library.page.selectAlbum"
        @play-track="library.page.playTrackFromLibrary"
        @play-album="library.page.playAlbumFromLibrary"
        @toggle-playback="library.page.toggleCurrentAlbumPlayback"
        @refresh-playlists="library.refreshPlaylists"
        @add-tracks-to-next="library.page.addTracksToNext"
        @add-tracks-to-queue-end="library.page.addTracksToQueueEnd"
        @add-tracks-to-playlist="library.addTracksToExistingPlaylist"
        @delete-track="library.requestTrackDeletion"
        @add-album-to-next="library.page.addAlbumToNext"
        @add-album-to-queue-end="library.page.addAlbumToQueueEnd"
        @add-album-to-playlist="library.addAlbumToExistingPlaylist"
        @delete-album="library.requestAlbumDeletion"
      />
    </section>
  </div>
  <DeleteAlbumDialog
    v-if="library.deleteAlbumTarget"
    :ref="library.elements.deleteAlbumDialog"
    :album="library.deleteAlbumTarget"
    :pending="library.page.isTrackActionPending"
    @confirm="library.confirmAlbumDeletion"
    @cancel="library.cancelAlbumDeletion"
  />
  <DeleteTrackDialog
    v-if="library.deleteTrackTarget"
    :ref="library.elements.deleteTrackDialog"
    :track="library.deleteTrackTarget"
    :is-deleting="library.page.isTrackActionPending"
    @confirm="library.confirmTrackDeletion"
    @cancel="library.cancelTrackDeletion"
  />
</template>

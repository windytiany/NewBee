<template>
  <ResizableThreeColumnLayout>
    <template #left>
      <GroupList :selected-artist="selectedArtist" @select="selectArtist" />
    </template>

    <template #center>
      <AlbumBrowser
        :artist="selectedArtist"
        :selected-album-id="selectedAlbumId"
        @update:selected-album-id="selectedAlbumId = $event"
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
import { usePersistentLibrarySelection } from "../composables/usePersistentLibrarySelection";
import AlbumBrowser from "../components/library/AlbumBrowser.vue";
import GroupList from "../components/GroupList.vue";
import ResizableThreeColumnLayout from "../components/ResizableThreeColumnLayout.vue";
import TrackInfo from "../components/TrackInfo.vue";
import TrackList from "../components/TrackList.vue";

const { selectedArtist, selectedAlbumId, selectArtist } = usePersistentLibrarySelection();
</script>

<template>
  <ResizableThreeColumnLayout>
    <template #left>
      <GroupList
        :artists="placeholderArtists"
        :selected-artist="selectedArtist"
        @select="selectArtist"
      />
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
import type { Artist } from "../types/artist";
import { usePersistentLibrarySelection } from "../composables/usePersistentLibrarySelection";
import AlbumBrowser from "../components/library/AlbumBrowser.vue";
import GroupList from "../components/library/GroupList.vue";
import ResizableThreeColumnLayout from "../components/layout/ResizableThreeColumnLayout.vue";
import TrackInfo from "../components/track/TrackInfo.vue";
import TrackList from "../components/track/TrackList.vue";

const placeholderArtists: Artist[] = [
  { name: "[Singles]", albumCount: 27 },
  { name: "American Football", albumCount: 1 },
  { name: "Bark Psychosis", albumCount: 3 },
  { name: "The Beatles", albumCount: 1 },
  { name: "Bob Dylan", albumCount: 2 },
  { name: "Chinese Football", albumCount: 2 },
  { name: "The Clash", albumCount: 1 },
  { name: "The Cure", albumCount: 2 },
  { name: "Deep Purple", albumCount: 1 },
  { name: "The Doors", albumCount: 1 },
  { name: "Dormir", albumCount: 1 },
  { name: "Draw the Emotional", albumCount: 2 },
  { name: "Elliott Smith", albumCount: 3 },
  { name: "Fiona Apple", albumCount: 2 },
  { name: "Godspeed You! Black Emperor", albumCount: 4 },
  { name: "Radiohead", albumCount: 9 },
  { name: "The Smashing Pumpkins", albumCount: 6 },
  { name: "The Strokes", albumCount: 4 },
];

const { selectedArtist, selectedAlbumId, selectArtist } =
  usePersistentLibrarySelection(placeholderArtists);
</script>

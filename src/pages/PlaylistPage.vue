<template>
  <ResizableThreeColumnLayout>
    <template #left>
      <PlaylistList />
    </template>

    <template #center>
      <h1 class="text-2xl font-bold">Playlist Page</h1>
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
import PlaylistList from "../components/playlist/PlaylistList.vue";
import ResizableThreeColumnLayout from "../components/layout/ResizableThreeColumnLayout.vue";
import TrackInfo from "../components/track/TrackInfo.vue";
import TrackList from "../components/track/TrackList.vue";
</script>

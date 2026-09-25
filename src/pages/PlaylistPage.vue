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
import PlaylistList from "../components/PlaylistList.vue";
import ResizableThreeColumnLayout from "../components/ResizableThreeColumnLayout.vue";
import TrackInfo from "../components/TrackInfo.vue";
import TrackList from "../components/TrackList.vue";
</script>

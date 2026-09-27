<script setup lang="ts">
import { computed } from "vue";
import { usePersistentActivePage } from "@/composables/usePersistentActivePage";
import LibraryPage from "@/pages/LibraryPage.vue";
import PlayingPage from "@/pages/PlayingPage.vue";
import PlaylistPage from "@/pages/PlaylistPage.vue";
import PlaybackBar from "@/components/PlaybackBar.vue";
import TopBar from "@/components/TopBar.vue";

const pageComponents = {
  Playing: PlayingPage,
  Library: LibraryPage,
  Playlist: PlaylistPage,
} as const;
const { activePage } = usePersistentActivePage();
const currentPageComponent = computed(() => pageComponents[activePage.value]);
</script>

<template>
  <div class="bg-spotify-base min-h-screen font-sans text-white">
    <TopBar v-model:active-page="activePage" />
    <main class="grid min-h-screen place-items-center pt-14 pb-20 sm:pb-10">
      <component :is="currentPageComponent" />
    </main>
    <PlaybackBar />
  </div>
</template>

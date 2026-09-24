<script setup lang="ts">
import { computed, ref } from "vue";
import LibraryPage from "./pages/LibraryPage.vue";
import PlayingPage from "./pages/PlayingPage.vue";
import PlaylistPage from "./pages/PlaylistPage.vue";
import type { PageName } from "./types/pages";
import PlaybackBar from "./components/PlaybackBar.vue";
import TopBar from "./components/TopBar.vue";

const pageComponents = {
  Playing: PlayingPage,
  Library: LibraryPage,
  Playlist: PlaylistPage,
} as const;
const activePage = ref<PageName>("Playing");
const currentPageComponent = computed(() => pageComponents[activePage.value]);
</script>

<template>
  <div class="min-h-screen bg-spotify-base font-sans text-white">
    <TopBar v-model:active-page="activePage" />
    <main class="grid min-h-screen place-items-center pb-20 pt-14 sm:pb-10">
      <component :is="currentPageComponent" />
    </main>
    <PlaybackBar />
  </div>
</template>

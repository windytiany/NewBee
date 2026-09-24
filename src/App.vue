<script setup lang="ts">
import PlaybackBar from "./components/PlaybackBar.vue";
import TopBar from "./components/TopBar.vue";
</script>

<template>
  <div class="min-h-screen bg-spotify-base font-sans text-white">
    <TopBar />
    <main class="grid min-h-screen place-items-center pb-20 pt-14 sm:pb-10">
      <h1 class="text-2xl font-bold">Hello, NewBee!</h1>
    </main>
    <PlaybackBar />
  </div>
</template>

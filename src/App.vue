<script setup lang="ts">
import PlaybackBar from "./components/PlaybackBar.vue";
import TopBar from "./components/TopBar.vue";
</script>

<template>
  <div class="min-h-screen bg-slate-950 font-sans text-slate-100">
    <TopBar />
    <main class="grid min-h-screen place-items-center pb-20 sm:pb-10">
      <h1 class="text-3xl font-semibold tracking-tight">Hello, NewBee!</h1>
    </main>
    <PlaybackBar />
  </div>
</template>

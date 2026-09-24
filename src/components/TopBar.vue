<template>
  <header
    class="fixed inset-x-0 top-0 z-50 grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center bg-spotify-base px-3 text-white sm:px-6"
  >
    <span class="justify-self-start whitespace-nowrap text-sm font-bold">NewBee</span>

    <nav
      aria-label="Main navigation"
      class="inline-flex items-center rounded-full bg-spotify-interactive p-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
    >
      <button
        v-for="tab in tabs"
        :key="tab"
        :aria-pressed="activeTab === tab"
        class="rounded-full px-2 py-2 text-xs font-semibold uppercase tracking-[1px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify-green sm:px-4 sm:text-sm sm:tracking-[1.4px]"
        :class="
          activeTab === tab ? 'bg-spotify-green text-black' : 'text-spotify-muted hover:text-white'
        "
        type="button"
        @click="activeTab = tab"
      >
        {{ tab }}
      </button>
    </nav>

    <span aria-hidden="true" />
  </header>
</template>

<script setup lang="ts">
import { ref } from "vue";

const tabs = ["Playing", "Library", "Playlist"] as const;
const activeTab = ref<(typeof tabs)[number]>("Playing");
</script>

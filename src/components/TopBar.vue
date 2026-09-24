<template>
  <header
    class="fixed inset-x-0 top-0 z-50 grid h-14 grid-cols-[1fr_auto_1fr] items-center bg-black px-6 text-white"
  >
    <span class="justify-self-start text-sm font-semibold">NewBee</span>

    <nav
      aria-label="Main navigation"
      class="inline-flex items-center rounded-2xl border border-white/10 bg-zinc-800/90 p-1 shadow-lg shadow-black/50 backdrop-blur-sm"
    >
      <button
        v-for="tab in tabs"
        :key="tab"
        :aria-pressed="activeTab === tab"
        class="rounded-xl px-5 py-2 text-sm transition-colors"
        :class="
          activeTab === tab
            ? 'bg-zinc-950 text-white shadow-sm shadow-black/40'
            : 'text-zinc-400 hover:text-zinc-100'
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

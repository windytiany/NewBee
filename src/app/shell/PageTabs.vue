<script setup lang="ts">
import { pageNames, type PageName } from "@/app/pages";
const props = defineProps<{ activePage: PageName }>();
const emit = defineEmits<{ "update:activePage": [page: PageName] }>();
</script>

<template>
  <nav
    aria-label="Main navigation"
    class="bg-app-interactive inline-flex items-center rounded-full p-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
  >
    <button
      v-for="pageName in pageNames"
      :key="pageName"
      :aria-pressed="props.activePage === pageName"
      class="focus-visible:outline-app-accent rounded-full px-2 py-2 text-xs font-semibold tracking-[1px] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-4 sm:text-sm sm:tracking-[1.4px]"
      :class="
        props.activePage === pageName
          ? 'bg-app-accent text-black'
          : 'text-app-muted hover:text-white'
      "
      type="button"
      @click="emit('update:activePage', pageName)"
    >
      {{ pageName }}
    </button>
  </nav>
</template>

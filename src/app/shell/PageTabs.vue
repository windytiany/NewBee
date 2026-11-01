<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { visiblePages, pageLabel, type PageName } from "@/app/pages";
const props = defineProps<{ activePage: PageName }>();
const emit = defineEmits<{ "update:activePage": [page: PageName] }>();
</script>

<template>
  <nav :aria-label="t('主导航')" class="inline-flex h-full items-stretch border-b border-white/10">
    <button
      v-for="pageName in visiblePages"
      :key="pageName"
      :aria-pressed="props.activePage === pageName"
      class="focus-visible:outline-app-accent relative px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 sm:px-5 sm:text-sm"
      :class="props.activePage === pageName ? 'text-app-accent' : 'text-app-muted hover:text-white'"
      type="button"
      @click="emit('update:activePage', pageName)"
    >
      {{ pageLabel(pageName) }}
      <span
        v-if="props.activePage === pageName"
        aria-hidden="true"
        class="bg-app-accent absolute inset-x-3 bottom-0 h-0.5 rounded-t-full sm:inset-x-5"
      ></span>
    </button>
  </nav>
</template>

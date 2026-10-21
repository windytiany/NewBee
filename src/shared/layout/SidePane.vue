<template>
  <aside
    :aria-label="side === 'left' ? t('左侧边栏') : t('右侧边栏')"
    class="sidebar-scrollbars bg-app-base h-full min-h-0 min-w-0 overflow-hidden"
    :class="side === 'left' ? 'border-r border-white/10' : 'border-l border-white/10'"
  >
    <slot />
  </aside>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";

defineProps<{
  side: "left" | "right";
}>();
</script>

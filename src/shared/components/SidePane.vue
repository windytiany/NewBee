<template>
  <aside
    :aria-label="side === 'left' ? '左侧边栏' : '右侧边栏'"
    class="sidebar-scrollbars bg-app-base h-full min-h-0 min-w-0 overflow-hidden"
    :class="side === 'left' ? 'border-r border-white/10' : 'border-l border-white/10'"
  >
    <slot />
  </aside>
</template>

<script setup lang="ts">
defineProps<{
  side: "left" | "right";
}>();
</script>

<template>
  <li>
    <button
      class="flex w-full min-w-0 items-center rounded-md px-1 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-spotify-green"
      :class="isFocused ? 'bg-spotify-interactive' : 'hover:bg-white/5'"
      :aria-current="isFocused ? 'true' : undefined"
      type="button"
      @click="emit('select')"
    >
      <span class="truncate text-base text-spotify-muted">{{ name }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
defineProps<{
  name: string;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>

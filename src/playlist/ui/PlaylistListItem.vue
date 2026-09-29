<template>
  <li>
    <button
      data-item-interaction
      class="focus-visible:outline-spotify-green flex w-full min-w-0 items-center rounded-md px-1 py-1.5 text-left transition-colors focus-visible:outline-2"
      :class="[
        isSelected ? 'border-l-2 border-white/60 bg-white/5 pl-1.5' : '',
        isFocused ? 'bg-spotify-interactive ring-spotify-green/60 ring-1' : 'hover:bg-white/5',
      ]"
      :aria-current="isSelected ? 'true' : undefined"
      type="button"
      @click="emit('select')"
    >
      <span class="text-spotify-muted truncate text-base">{{ name }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
defineProps<{
  name: string;
  isFocused: boolean;
  isSelected: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>

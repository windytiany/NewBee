<template>
  <li>
    <button
      data-item-interaction
      class="focus-visible:outline-spotify-green flex w-full min-w-0 items-center rounded-md px-1 py-1.5 text-left transition-colors focus-visible:outline-2"
      :class="isFocused ? 'bg-spotify-track' : 'hover:bg-white/5'"
      :aria-current="isSelected ? 'true' : undefined"
      type="button"
      @click="emit('select')"
    >
      <span
        class="truncate text-base"
        :class="isFocused ? 'text-spotify-green' : 'text-spotify-muted'"
      >
        {{ name }}
      </span>
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

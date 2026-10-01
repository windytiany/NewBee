<template>
  <li>
    <button
      data-item-interaction
      class="focus-visible:bg-spotify-track flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors outline-none"
      :class="isFocused ? 'bg-spotify-track' : 'hover:bg-white/5'"
      :aria-current="isSelected ? 'true' : undefined"
      type="button"
      @click="emit('select')"
    >
      <span
        aria-hidden="true"
        class="from-spotify-interactive text-spotify-muted grid size-12 shrink-0 place-items-center rounded-sm bg-linear-to-br to-[#242424]"
      >
        <UserRound class="size-6" />
      </span>
      <span class="flex min-w-0 flex-col">
        <span class="truncate text-sm font-medium text-white">
          {{ name }}
        </span>
        <span class="text-spotify-muted text-xs">{{ albumCount }} 张专辑</span>
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { UserRound } from "@lucide/vue";

defineProps<{
  name: string;
  albumCount: number;
  isSelected: boolean;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>

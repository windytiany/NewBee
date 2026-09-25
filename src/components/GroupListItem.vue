<template>
  <li>
    <button
      class="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-spotify-green"
      :class="isFocused ? 'bg-spotify-interactive' : 'hover:bg-white/5'"
      :aria-current="isFocused ? 'true' : undefined"
      type="button"
      @click="emit('select')"
    >
      <span
        aria-hidden="true"
        class="grid size-16 shrink-0 place-items-center rounded-sm bg-linear-to-br from-spotify-interactive to-[#242424] text-spotify-muted"
      >
        <UserRound class="size-8" />
      </span>
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="truncate text-base font-medium text-white">{{ name }}</span>
        <span class="text-sm text-spotify-muted">{{ albumCount }} 张专辑</span>
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { UserRound } from "@lucide/vue";

defineProps<{
  name: string;
  albumCount: number;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>

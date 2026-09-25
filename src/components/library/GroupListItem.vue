<template>
  <li>
    <button
      class="focus-visible:outline-spotify-green flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors focus-visible:outline-2"
      :class="isFocused ? 'bg-spotify-interactive' : 'hover:bg-white/5'"
      :aria-current="isFocused ? 'true' : undefined"
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
        <span class="truncate text-sm font-medium text-white">{{ name }}</span>
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
  isFocused: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>

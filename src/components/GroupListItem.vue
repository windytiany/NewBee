<template>
  <li>
    <div class="flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5">
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
    </div>
  </li>
</template>

<script setup lang="ts">
import { UserRound } from "@lucide/vue";

defineProps<{
  name: string;
  albumCount: number;
}>();
</script>

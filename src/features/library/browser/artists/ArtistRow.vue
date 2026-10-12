<template>
  <li>
    <button
      data-item-interaction
      class="focus-visible:bg-app-track flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors outline-none"
      :class="isFocused ? 'bg-app-track' : 'hover:bg-white/5'"
      :aria-current="isSelected ? 'true' : undefined"
      type="button"
      @click="emit('select')"
    >
      <ArtistPhoto :artist="artist" class="size-10" />
      <span class="flex min-w-0 flex-col">
        <span class="truncate text-sm font-medium text-white">
          {{ name }}
        </span>
        <span class="text-app-muted text-xs">{{ t("{count} 张专辑", { count: albumCount }) }}</span>
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import ArtistPhoto from "@/features/artwork/artist/ArtistPhoto.vue";
defineProps<{
  artist: string | null;
  name: string;
  albumCount: number;
  isSelected: boolean;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>

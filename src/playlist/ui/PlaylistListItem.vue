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
      <TrackArtwork :track-id="coverTrackId" alt="" class="mr-2 size-10 shrink-0 rounded-md">
        <div
          aria-hidden="true"
          class="grid h-full w-full place-items-center rounded-md bg-linear-to-br from-violet-800 via-indigo-950 to-slate-950"
        >
          <DiscAlbum aria-hidden="true" class="size-5 text-white/75" stroke-width="1.25" />
        </div>
      </TrackArtwork>
      <span
        class="min-w-0 flex-1 truncate text-base"
        :class="isFocused ? 'text-spotify-green' : 'text-spotify-muted'"
      >
        {{ name }}
      </span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { DiscAlbum } from "@lucide/vue";
import TrackArtwork from "@/artwork/ui/TrackArtwork.vue";

defineProps<{
  name: string;
  coverTrackId: number | null;
  isFocused: boolean;
  isSelected: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();
</script>

<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <article class="group min-w-0">
    <button
      class="focus-visible:outline-spotify-green block w-full rounded-md text-center focus-visible:outline-2 focus-visible:outline-offset-4"
      :aria-label="`查看专辑 ${album.album ?? '未知专辑'}`"
      :aria-expanded="isSelected"
      type="button"
      @click="emit('select')"
    >
      <span
        aria-hidden="true"
        class="mb-3 grid aspect-square w-full place-items-center overflow-hidden rounded-md bg-linear-to-br shadow-lg transition-transform duration-200 group-hover:-translate-y-1"
        :class="[coverPalette, isSelected || isFocused ? 'ring-spotify-green ring-2' : '']"
      >
        <DiscAlbum class="size-14 text-white/70 sm:size-16" stroke-width="1.25" />
      </span>
      <span class="block truncate text-sm font-semibold text-white">
        {{ album.album ?? "未知专辑" }}
      </span>
      <span class="text-spotify-muted mt-1 block truncate text-xs">
        {{ album.trackCount }} 首曲目
      </span>
    </button>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { DiscAlbum } from "@lucide/vue";
import type { AlbumSummary } from "../../types/library";

const props = defineProps<{
  album: AlbumSummary;
  coverIndex: number;
  isSelected: boolean;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

const coverPalettes = [
  "from-sky-950 via-blue-900/80 to-slate-950",
  "from-indigo-950 via-violet-900/80 to-slate-950",
  "from-emerald-950 via-teal-900/80 to-slate-950",
  "from-rose-950 via-orange-900/70 to-slate-950",
] as const;

const coverPalette = computed(() => coverPalettes[props.coverIndex % coverPalettes.length]);
</script>

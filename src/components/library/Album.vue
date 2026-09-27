<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <article class="group min-w-0">
    <button
      class="focus-visible:outline-spotify-green block w-full rounded-md text-center focus-visible:outline-2 focus-visible:outline-offset-4"
      :aria-label="`查看专辑 ${album.album ?? '未知专辑'}`"
      :aria-expanded="isSelected"
      :title="artworkLoadFailed ? '专辑封面加载失败' : undefined"
      type="button"
      @click="emit('select')"
    >
      <span
        aria-hidden="true"
        class="mb-3 grid aspect-square w-full place-items-center overflow-hidden rounded-md bg-linear-to-br shadow-lg transition-transform duration-200 group-hover:-translate-y-1"
        :class="[coverPalette, isSelected || isFocused ? 'ring-spotify-green ring-2' : '']"
      >
        <img
          v-if="artworkUrl"
          :src="artworkUrl"
          alt=""
          class="size-full object-cover"
          @error="handleArtworkError"
        />
        <DiscAlbum v-else class="size-14 text-white/70 sm:size-16" stroke-width="1.25" />
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
import { invoke } from "@tauri-apps/api/core";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { DiscAlbum } from "@lucide/vue";
import type { AlbumSummary } from "@/types/album";
import type { TrackArtwork } from "@/types/track";

const props = defineProps<{
  album: AlbumSummary;
  albumArtist: string | null;
  coverIndex: number;
  isSelected: boolean;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

const artworkUrl = ref<string | null>(null);
const artworkLoadFailed = ref(false);
let artworkRequestGeneration = 0;

function revokeArtwork() {
  const url = artworkUrl.value;
  if (url) globalThis.URL.revokeObjectURL(url);
  artworkUrl.value = null;
}

async function loadArtwork() {
  const generation = ++artworkRequestGeneration;
  revokeArtwork();
  artworkLoadFailed.value = false;

  try {
    const artwork = await invoke<TrackArtwork | null>("get_album_artwork", {
      albumArtist: props.albumArtist,
      album: props.album.album,
    });
    if (generation !== artworkRequestGeneration) return;
    if (!artwork || artwork.status !== "available") return;

    const imageBlob = new globalThis.Blob([Uint8Array.from(artwork.data)], {
      type: artwork.mimeType,
    });
    artworkUrl.value = globalThis.URL.createObjectURL(imageBlob);
  } catch {
    if (generation !== artworkRequestGeneration) return;
    artworkLoadFailed.value = true;
  }
}

function handleArtworkError() {
  artworkLoadFailed.value = true;
  revokeArtwork();
}

watch(
  () => [props.albumArtist, props.album.album] as const,
  () => void loadArtwork(),
  {
    immediate: true,
  },
);

onBeforeUnmount(() => {
  ++artworkRequestGeneration;
  revokeArtwork();
});

const coverPalettes = [
  "from-sky-950 via-blue-900/80 to-slate-950",
  "from-indigo-950 via-violet-900/80 to-slate-950",
  "from-emerald-950 via-teal-900/80 to-slate-950",
  "from-rose-950 via-orange-900/70 to-slate-950",
] as const;

const coverPalette = computed(() => coverPalettes[props.coverIndex % coverPalettes.length]);
</script>

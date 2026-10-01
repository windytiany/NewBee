<template>
  <article class="min-w-0">
    <button
      data-item-interaction
      class="focus-visible:ring-spotify-green block w-full rounded-md p-3 text-center transition-colors outline-none hover:bg-white/5 focus-visible:ring-2"
      :class="isFocused ? 'ring-spotify-green ring-2' : ''"
      :aria-label="`查看专辑 ${album.album ?? '未知专辑'}`"
      :aria-expanded="isSelected"
      :title="artworkLoadFailed ? '专辑封面加载失败' : undefined"
      type="button"
      aria-haspopup="menu"
      :aria-controls="props.isContextMenuOpen ? 'album-context-menu' : undefined"
      @click="emit('select')"
      @contextmenu="openAlbumContextMenu"
      @keydown="handleContextMenuKeydown"
    >
      <span
        aria-hidden="true"
        class="mb-3 grid aspect-square w-full place-items-center overflow-hidden rounded-md"
        :class="[
          showFallback ? coverPalette : 'bg-transparent',
          showFallback || artworkImageLoaded ? 'shadow-lg' : 'shadow-none',
        ]"
      >
        <img
          v-if="artworkUrl"
          :src="artworkUrl"
          alt=""
          class="size-full object-cover"
          @load="artworkImageLoaded = true"
          @error="handleArtworkError"
        />
        <DiscAlbum
          v-else-if="showFallback"
          class="size-14 text-white/70 sm:size-16"
          stroke-width="1.25"
        />
      </span>
      <span class="block truncate text-sm font-semibold text-white">
        {{ album.album ?? "未知专辑" }}
      </span>
      <span class="text-spotify-muted mt-1 block truncate text-xs">
        {{ album.year ?? "年份未知" }}
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
  isContextMenuOpen?: boolean;
}>();

const emit = defineEmits<{
  select: [];
  contextMenu: [
    request: { x: number; y: number; trigger: InstanceType<typeof globalThis.HTMLButtonElement> },
  ];
}>();

function openAlbumContextMenu(event: InstanceType<typeof globalThis.MouseEvent>) {
  event.preventDefault();
  event.stopPropagation();
  emit("contextMenu", {
    x: event.clientX,
    y: event.clientY,
    trigger: event.currentTarget as InstanceType<typeof globalThis.HTMLButtonElement>,
  });
}

function handleContextMenuKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  event.stopPropagation();
  const trigger = event.currentTarget as InstanceType<typeof globalThis.HTMLButtonElement>;
  const bounds = trigger.getBoundingClientRect();
  emit("contextMenu", { x: bounds.left, y: bounds.bottom, trigger });
}

const artworkUrl = ref<string | null>(null);
const artworkLoadFailed = ref(false);
const artworkResolved = ref(false);
const artworkImageLoaded = ref(false);
const showFallback = computed(
  () => artworkResolved.value && (artworkLoadFailed.value || artworkUrl.value === null),
);
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
  artworkResolved.value = false;
  artworkImageLoaded.value = false;

  try {
    const artwork = await invoke<TrackArtwork | null>("get_album_artwork", {
      albumArtist: props.albumArtist,
      album: props.album.album,
    });
    if (generation !== artworkRequestGeneration) return;
    artworkResolved.value = true;
    if (!artwork || artwork.status !== "available") return;

    const imageBlob = new globalThis.Blob([Uint8Array.from(artwork.data)], {
      type: artwork.mimeType,
    });
    artworkUrl.value = globalThis.URL.createObjectURL(imageBlob);
  } catch {
    if (generation !== artworkRequestGeneration) return;
    artworkLoadFailed.value = true;
    artworkResolved.value = true;
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

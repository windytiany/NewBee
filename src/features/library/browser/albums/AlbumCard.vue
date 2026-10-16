<template>
  <article class="min-w-0">
    <button
      data-item-interaction
      data-album-card
      data-keyboard-item
      class="focus-visible:ring-app-accent block w-full rounded-md p-3 text-center transition-colors outline-none hover:bg-white/5 focus-visible:ring-2"
      :class="isFocused ? 'ring-app-accent ring-2' : ''"
      :aria-label="t('查看专辑 {album}', { album: album.album ?? t('未知专辑') })"
      :aria-expanded="isSelected"
      type="button"
      aria-haspopup="menu"
      :aria-controls="props.isContextMenuOpen ? 'album-context-menu' : undefined"
      @click="emit('select')"
      @contextmenu="openAlbumContextMenu"
      @keydown="handleContextMenuKeydown"
    >
      <span
        ref="coverElement"
        aria-hidden="true"
        class="mb-3 grid aspect-square w-full place-items-center overflow-hidden rounded-md"
        :class="[
          showFallback ? coverPalette : 'bg-transparent',
          showFallback || artworkImageLoaded ? 'shadow-lg' : 'shadow-none',
        ]"
        @click.stop="handleCoverClick"
        @dblclick.stop="playAlbum"
      >
        <img v-if="artworkUrl" :src="artworkUrl" alt="" class="size-full object-cover" />
        <DiscAlbum
          v-else-if="showFallback"
          class="size-14 text-white/70 sm:size-16"
          stroke-width="1.25"
        />
      </span>
      <span class="block truncate text-sm font-semibold text-white">
        {{ album.album ?? t("未知专辑") }}
      </span>
      <span class="text-app-muted mt-1 block truncate text-xs">
        {{ album.year ?? t("年份未知") }}
      </span>
    </button>
  </article>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, onUnmounted, ref } from "vue";
import { DiscAlbum } from "@lucide/vue";
import type { AlbumSummary } from "@/features/library/types";
import { useArtworkSize } from "@/features/artwork/useArtworkSize";
import { useAlbumArtwork } from "@/features/artwork/useAlbumArtwork";

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
  play: [];
  contextMenu: [
    request: { x: number; y: number; trigger: InstanceType<typeof globalThis.HTMLButtonElement> },
  ];
}>();

const COLLAPSED_COVER_DOUBLE_CLICK_WINDOW_MS = 300;
const EXPANDED_COVER_DOUBLE_CLICK_WINDOW_MS = 150;
let coverDoubleClickWindowMs = COLLAPSED_COVER_DOUBLE_CLICK_WINDOW_MS;
let pendingCoverClick: ReturnType<typeof globalThis.setTimeout> | undefined;
let lastCoverClickAt: number | null = null;
let isCoverDoubleClick = false;

function cancelCoverClick() {
  globalThis.clearTimeout(pendingCoverClick);
  pendingCoverClick = undefined;
}

function handleCoverClick(event: InstanceType<typeof globalThis.MouseEvent>) {
  cancelCoverClick();
  isCoverDoubleClick =
    event.detail === 2 &&
    lastCoverClickAt !== null &&
    event.timeStamp - lastCoverClickAt <= coverDoubleClickWindowMs;
  lastCoverClickAt = event.timeStamp;
  if (isCoverDoubleClick) return;
  coverDoubleClickWindowMs = props.isSelected
    ? EXPANDED_COVER_DOUBLE_CLICK_WINDOW_MS
    : COLLAPSED_COVER_DOUBLE_CLICK_WINDOW_MS;
  if (!props.isSelected) {
    emit("select");
    return;
  }
  pendingCoverClick = globalThis.setTimeout(() => {
    pendingCoverClick = undefined;
    emit("select");
  }, coverDoubleClickWindowMs);
}

function playAlbum() {
  if (!isCoverDoubleClick) return;
  cancelCoverClick();
  isCoverDoubleClick = false;
  lastCoverClickAt = null;
  emit("play");
}

onUnmounted(cancelCoverClick);

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

const coverElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const size = useArtworkSize(coverElement);
const artwork = useAlbumArtwork(
  () => ({
    albumArtist: props.albumArtist,
    album: props.album.album,
  }),
  "cover",
  size,
);
const artworkUrl = artwork.url;
const artworkImageLoaded = computed(() => artwork.status.value === "ready");
const showFallback = computed(() => artwork.status.value === "fallback");

const coverPalettes = [
  "from-sky-950 via-blue-900/80 to-slate-950",
  "from-indigo-950 via-violet-900/80 to-slate-950",
  "from-emerald-950 via-teal-900/80 to-slate-950",
  "from-rose-950 via-orange-900/70 to-slate-950",
] as const;

const coverPalette = computed(() => coverPalettes[props.coverIndex % coverPalettes.length]);
</script>

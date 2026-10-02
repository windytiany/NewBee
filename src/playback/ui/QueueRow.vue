<template>
  <li :aria-current="isCurrentTrack ? 'true' : undefined">
    <button
      data-item-interaction
      class="focus-visible:bg-spotify-track flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors outline-none"
      :class="isFocused ? 'bg-spotify-track' : isSelected ? 'bg-white/10' : 'hover:bg-white/5'"
      :aria-pressed="isSelected ? true : undefined"
      :aria-haspopup="props.canRemoveFromQueue ? 'menu' : undefined"
      :aria-expanded="props.canRemoveFromQueue ? props.isContextMenuOpen : undefined"
      type="button"
      @click="handleTrackClick"
      @dblclick="handleTrackDoubleClick"
      @contextmenu="openQueueContextMenu"
      @keydown="handleContextMenuKeydown"
    >
      <span
        aria-hidden="true"
        class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-sm"
      >
        <img
          v-if="artworkUrl"
          :src="artworkUrl"
          alt=""
          class="size-full object-cover transition-opacity"
          :class="artworkStatus === 'available' ? 'opacity-100' : 'opacity-0'"
          @load="onArtworkLoad"
          @error="onArtworkError"
        />
        <Disc3
          v-else-if="artworkStatus === 'missing' || artworkStatus === 'failed'"
          class="size-5 text-sky-200/80"
        />
      </span>
      <AudioLines
        v-if="isCurrentTrack"
        aria-hidden="true"
        class="text-spotify-green size-4 shrink-0"
      />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          class="truncate text-sm font-medium"
          :class="isCurrentTrack ? 'text-spotify-green' : 'text-white'"
        >
          {{ title }}
        </span>
        <span class="text-spotify-muted truncate text-xs">{{ album }}</span>
      </span>
      <span class="text-spotify-muted shrink-0 pl-1 text-xs tabular-nums">{{ duration }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { AudioLines, Disc3 } from "@lucide/vue";
import { onBeforeUnmount, ref, watch } from "vue";
import type { ItemSelectionModifiers } from "@/interaction/itemFocus";
import type { TrackArtwork } from "@/artwork/types";

const props = withDefaults(
  defineProps<{
    trackId: number;
    rowKey: string;
    title: string;
    album: string;
    duration: string;
    isCurrentTrack?: boolean;
    isSelected?: boolean;
    isFocused: boolean;
    canRemoveFromQueue?: boolean;
    isContextMenuOpen?: boolean;
  }>(),
  {
    isCurrentTrack: false,
    isSelected: false,
    canRemoveFromQueue: false,
    isContextMenuOpen: false,
  },
);

const emit = defineEmits<{
  select: [modifiers: ItemSelectionModifiers];
  play: [];
  contextMenu: [
    request: {
      rowKey: string;
      x: number;
      y: number;
      trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
    },
  ];
}>();

function handleTrackClick(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (event.button === 0) {
    emit("select", { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
  }
}

function handleTrackDoubleClick(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (event.button === 0) emit("play");
}

function openQueueContextMenu(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (!props.canRemoveFromQueue) return;

  event.preventDefault();
  event.stopPropagation();
  emit("contextMenu", {
    rowKey: props.rowKey,
    x: event.clientX,
    y: event.clientY,
    trigger: event.currentTarget as InstanceType<typeof globalThis.HTMLButtonElement>,
  });
}

function handleContextMenuKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (
    !props.canRemoveFromQueue ||
    (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey))
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const trigger = event.currentTarget as InstanceType<typeof globalThis.HTMLButtonElement>;
  const bounds = trigger.getBoundingClientRect();
  emit("contextMenu", {
    rowKey: props.rowKey,
    x: bounds.left,
    y: bounds.bottom,
    trigger,
  });
}

const artworkUrl = ref<string | null>(null);
const artworkStatus = ref<"loading" | "available" | "missing" | "failed">("loading");
let artworkRequestGeneration = 0;

function revokeArtworkUrl() {
  const url = artworkUrl.value;
  if (url) globalThis.URL.revokeObjectURL(url);
  artworkUrl.value = null;
}

async function loadArtwork(trackId: number) {
  const generation = ++artworkRequestGeneration;
  revokeArtworkUrl();
  artworkStatus.value = "loading";

  try {
    const artwork = await invoke<TrackArtwork | null>("get_track_artwork", { trackId });
    if (generation !== artworkRequestGeneration || props.trackId !== trackId) return;

    if (!artwork || artwork.status !== "available") {
      artworkStatus.value = "missing";
      return;
    }

    const imageBlob = new globalThis.Blob([Uint8Array.from(artwork.data)], {
      type: artwork.mimeType,
    });
    artworkUrl.value = globalThis.URL.createObjectURL(imageBlob);
  } catch {
    if (generation !== artworkRequestGeneration || props.trackId !== trackId) return;
    artworkStatus.value = "failed";
  }
}

function onArtworkLoad(event: globalThis.Event) {
  const image = event.currentTarget;
  if (
    image instanceof globalThis.HTMLImageElement &&
    image.src === artworkUrl.value &&
    image.complete
  ) {
    artworkStatus.value = "available";
  }
}

function onArtworkError(event: globalThis.Event) {
  const image = event.currentTarget;
  if (!(image instanceof globalThis.HTMLImageElement) || image.src !== artworkUrl.value) return;

  revokeArtworkUrl();
  artworkStatus.value = "failed";
}

watch(() => props.trackId, loadArtwork, { immediate: true, flush: "sync" });

onBeforeUnmount(() => {
  ++artworkRequestGeneration;
  revokeArtworkUrl();
});
</script>

<template>
  <li :aria-current="isCurrentTrack ? 'true' : undefined">
    <button
      class="focus-visible:outline-spotify-green flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors focus-visible:outline-2"
      :class="
        isSelected
          ? 'bg-white/10 ring-1 ring-white/10 ring-inset'
          : isFocused
            ? 'bg-spotify-interactive'
            : 'hover:bg-white/5'
      "
      :aria-pressed="isSelected ? true : undefined"
      type="button"
      @click="emit('select')"
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
import type { TrackArtwork } from "@/types/track";

const props = withDefaults(
  defineProps<{
    trackId: number;
    title: string;
    album: string;
    duration: string;
    isCurrentTrack?: boolean;
    isSelected?: boolean;
    isFocused: boolean;
  }>(),
  {
    isCurrentTrack: false,
    isSelected: false,
  },
);

const emit = defineEmits<{
  select: [];
}>();

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

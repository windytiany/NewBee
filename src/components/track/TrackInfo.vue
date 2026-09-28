<template>
  <section
    aria-label="曲目信息"
    class="bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto text-white"
  >
    <h2 class="shrink-0 px-1 py-2 text-sm font-medium text-white/90">曲目信息</h2>

    <div class="px-1 pb-3">
      <p v-if="isLoading" class="text-spotify-muted py-3 text-sm" role="status">
        正在读取曲目信息…
      </p>
      <p v-else-if="currentTrackDetailsError" class="py-3 text-sm text-red-300" role="alert">
        {{ currentTrackDetailsError }}
      </p>
      <template v-if="currentTrackDetails">
        <h1 class="truncate text-sm font-semibold">
          {{ currentTrackDetails.title ?? "未知曲目" }}
        </h1>
        <p class="text-spotify-muted truncate text-sm">
          {{ currentTrackDetails.artist ?? "未知艺术家" }}
        </p>
        <p class="text-spotify-muted truncate text-sm">
          {{ currentTrackDetails.album ?? "未知专辑" }}
        </p>
        <p v-if="currentTrackDetails.releaseDate" class="text-spotify-muted truncate text-sm">
          {{ currentTrackDetails.releaseDate }}
        </p>
        <p class="text-spotify-muted mt-1 text-xs leading-4">
          {{ formatAudioSummary(currentTrackDetails) }}
        </p>
      </template>
      <p
        v-else-if="!isLoading && !currentTrackDetailsError"
        class="text-spotify-muted py-3 text-sm"
      >
        开始播放后显示当前曲目信息和封面。
      </p>

      <div
        v-if="currentTrackDetails || isLoading || currentTrackDetailsError"
        :aria-label="`${currentTrackDetails?.album ?? '专辑'} 封面`"
        class="mt-3 grid aspect-square w-full place-items-center overflow-hidden bg-linear-to-br from-[#182c68] via-[#10142e] to-[#090a12] text-blue-300/70"
        role="img"
      >
        <img
          v-if="currentTrackArtworkUrl"
          :src="currentTrackArtworkUrl"
          :alt="`${currentTrackDetails?.album ?? '专辑'} 封面`"
          class="h-full w-full object-cover"
        />
        <Disc3 v-else aria-hidden="true" class="size-20" stroke-width="1" />
      </div>
      <p v-if="currentTrackArtworkError" class="text-spotify-muted mt-2 text-xs" role="status">
        {{ currentTrackArtworkError }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { onBeforeUnmount, ref, watch } from "vue";
import { Disc3 } from "@lucide/vue";
import { usePlaybackState } from "@/composables/usePlaybackState";
import type { TrackArtwork, TrackDetails } from "@/types/track";
import { formatAudioSummary } from "@/utils/formatTrack.ts";

const { currentTrack } = usePlaybackState();
const currentTrackDetails = ref<TrackDetails | null>(null);
const currentTrackArtworkUrl = ref<string | null>(null);
const isLoading = ref(false);
const currentTrackDetailsError = ref("");
const currentTrackArtworkError = ref("");
let currentTrackDetailsRequestGeneration = 0;
let currentTrackArtworkRequestGeneration = 0;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "未知错误";
}

function revokeCurrentTrackArtwork() {
  const artworkUrl = currentTrackArtworkUrl.value;
  if (artworkUrl) globalThis.URL.revokeObjectURL(artworkUrl);
  currentTrackArtworkUrl.value = null;
}

function syncCurrentTrackInfo(trackId: number | null) {
  ++currentTrackDetailsRequestGeneration;
  ++currentTrackArtworkRequestGeneration;
  currentTrackDetails.value = null;
  isLoading.value = trackId !== null;
  currentTrackDetailsError.value = "";
  currentTrackArtworkError.value = "";
  revokeCurrentTrackArtwork();

  if (trackId === null) return;
  void loadCurrentTrackDetails(trackId);
  void loadCurrentTrackArtwork(trackId);
}

async function loadCurrentTrackDetails(trackId: number) {
  const generation = ++currentTrackDetailsRequestGeneration;
  isLoading.value = true;
  currentTrackDetailsError.value = "";

  try {
    const result = await invoke<TrackDetails | null>("get_track", { trackId });
    if (
      generation !== currentTrackDetailsRequestGeneration ||
      currentTrack.value?.trackId !== trackId
    ) {
      return;
    }

    if (!result) {
      currentTrackDetailsError.value = "未找到正在播放曲目的详情。";
      return;
    }
    if (result.id !== trackId) {
      currentTrackDetailsError.value = "返回的曲目详情与当前播放曲目不匹配。";
      return;
    }

    currentTrackDetails.value = result;
  } catch (error) {
    if (
      generation !== currentTrackDetailsRequestGeneration ||
      currentTrack.value?.trackId !== trackId
    ) {
      return;
    }
    currentTrackDetailsError.value = `读取曲目详情失败：${errorMessage(error)}`;
  } finally {
    if (
      generation === currentTrackDetailsRequestGeneration &&
      currentTrack.value?.trackId === trackId
    ) {
      isLoading.value = false;
    }
  }
}

async function loadCurrentTrackArtwork(trackId: number) {
  const generation = ++currentTrackArtworkRequestGeneration;
  revokeCurrentTrackArtwork();
  currentTrackArtworkError.value = "";

  try {
    const artwork = await invoke<TrackArtwork | null>("get_track_artwork", { trackId });
    if (
      generation !== currentTrackArtworkRequestGeneration ||
      currentTrack.value?.trackId !== trackId
    ) {
      return;
    }

    if (!artwork || artwork.status !== "available") {
      revokeCurrentTrackArtwork();
      return;
    }

    const imageBlob = new globalThis.Blob([Uint8Array.from(artwork.data)], {
      type: artwork.mimeType,
    });
    currentTrackArtworkUrl.value = globalThis.URL.createObjectURL(imageBlob);
  } catch (error) {
    if (
      generation !== currentTrackArtworkRequestGeneration ||
      currentTrack.value?.trackId !== trackId
    ) {
      return;
    }
    revokeCurrentTrackArtwork();
    currentTrackArtworkError.value = `读取封面失败，已显示占位图：${errorMessage(error)}`;
  }
}

watch(() => currentTrack.value?.trackId ?? null, syncCurrentTrackInfo, { immediate: true });

onBeforeUnmount(() => {
  ++currentTrackDetailsRequestGeneration;
  ++currentTrackArtworkRequestGeneration;
  revokeCurrentTrackArtwork();
});
</script>

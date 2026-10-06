<template>
  <button
    role="menuitem"
    type="button"
    :disabled="props.disabled || confirmation.busy.value"
    class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    @click.stop="download"
  >
    更新缺少的歌词
  </button>
  <button
    v-if="batch.state.synchronizationError"
    role="menuitem"
    type="button"
    :disabled="props.disabled || confirmation.busy.value"
    class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    @click.stop="retrySynchronization"
  >
    重试歌词界面刷新
  </button>
</template>

<script setup lang="ts">
import { useLyricsConfirmation } from "@/features/lyrics/download/confirmation";
import { useLyricsBatch } from "@/features/lyrics/download/batch";
import type { LibraryAlbumSelection } from "@/features/library/types";
const props = defineProps<{
  trackIds?: readonly number[];
  album?: LibraryAlbumSelection;
  disabled?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const confirmation = useLyricsConfirmation();
const batch = useLyricsBatch();
function retrySynchronization() {
  if (props.disabled || confirmation.busy.value) return;
  emit("close");
  void batch.retrySynchronization();
}
function download() {
  if (props.disabled || confirmation.busy.value) return;
  const album = props.album;
  const ids = [...(props.trackIds ?? [])];
  emit("close");
  if (album) void confirmation.openAlbum(album);
  else void confirmation.openTracks(ids);
}
</script>

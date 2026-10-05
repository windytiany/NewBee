<template>
  <button
    role="menuitem"
    type="button"
    :disabled="props.disabled || batch.state.running"
    class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    @click.stop="download"
  >
    更新缺少的歌词
  </button>
</template>

<script setup lang="ts">
import { useLyricsBatch } from "@/lyricsDownload/batch";
import type { LibraryAlbumSelection } from "@/library/selection";
const props = defineProps<{
  trackIds?: readonly number[];
  album?: LibraryAlbumSelection;
  disabled?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const batch = useLyricsBatch();
function download() {
  if (props.disabled || batch.state.running) return;
  const album = props.album;
  const ids = [...(props.trackIds ?? [])];
  emit("close");
  if (album) void batch.startAlbum(album);
  else void batch.startTracks(ids);
}
</script>

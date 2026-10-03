<template>
  <button
    class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    role="menuitem"
    type="button"
    :disabled="props.disabled || editor.state.open"
    @click.stop="edit"
  >
    编辑
  </button>
</template>

<script setup lang="ts">
import { useMetadataEditor } from "@/metadata/editor";
import type { LibraryAlbumSelection } from "@/library/selection";

const props = defineProps<{
  trackIds?: readonly number[];
  album?: LibraryAlbumSelection;
  disabled?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const editor = useMetadataEditor();
function edit() {
  if (props.disabled || editor.state.open) return;
  const album = props.album;
  const ids = [...(props.trackIds ?? [])];
  emit("close");
  if (album) void editor.openAlbum(album);
  else void editor.openTracks(ids);
}
</script>

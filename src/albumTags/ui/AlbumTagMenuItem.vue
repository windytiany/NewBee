<script setup lang="ts">
import type { LibraryAlbumSelection } from "@/library/selection";
import { useAlbumTagEditor } from "@/albumTags/editor";
const props = defineProps<{ album: LibraryAlbumSelection; disabled?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const editor = useAlbumTagEditor();
function open() {
  if (props.disabled || editor.state.open) return;
  const album = { ...props.album };
  emit("close");
  void editor.open(album);
}
</script>

<template>
  <button
    type="button"
    role="menuitem"
    :disabled="disabled || editor.state.open"
    class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    @click.stop="open"
  >
    根据专辑更新标签
  </button>
</template>

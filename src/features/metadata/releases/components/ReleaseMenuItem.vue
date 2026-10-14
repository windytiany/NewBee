<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import type { LibraryAlbumSelection } from "@/features/library/types";
import { useReleaseEditor } from "@/features/metadata/releases/useEditor";
const props = defineProps<{
  album?: LibraryAlbumSelection;
  trackIds?: readonly number[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const editor = useReleaseEditor();
async function open() {
  if (props.disabled || editor.state.open) return;
  const album = props.album;
  const ids = [...(props.trackIds ?? [])];
  emit("close");
  if (album) await editor.open({ ...album });
  else await editor.openTracks(ids);
}
</script>

<template>
  <button
    type="button"
    role="menuitem"
    :disabled="disabled || editor.state.open"
    class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    @click.stop="open"
  >
    {{ t("根据专辑更新标签") }}
  </button>
</template>

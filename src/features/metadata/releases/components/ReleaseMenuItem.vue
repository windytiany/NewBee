<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import type { LibraryAlbumSelection } from "@/features/library/types";
import { useReleaseEditor } from "@/features/metadata/releases/useEditor";
import { createTracksApi } from "@/features/tracks/api";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
const props = defineProps<{
  album?: LibraryAlbumSelection;
  paths?: readonly string[];
  trackIds?: readonly number[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const editor = useReleaseEditor();
async function open() {
  if (props.disabled || editor.state.open) return;
  const album = props.album;
  const paths = [...(props.paths ?? [])];
  const ids = [...(props.trackIds ?? [])];
  emit("close");
  try {
    if (album) await editor.open({ ...album });
    else {
      if (ids.length) {
        const tracks = await createTracksApi().getTracks(ids);
        if (tracks.length !== new Set(ids).size) throw new Error("Missing release targets");
        paths.push(...tracks.map((track) => track.path));
      }
      await editor.openFiles([...new Set(paths)]);
    }
  } catch (error) {
    logger.error("metadata", "release_targets_failed", error);
    notify({ type: "error", message: t("读取本地标签失败，请查看日志") });
  }
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

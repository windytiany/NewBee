<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { useTrackReveal } from "@/features/tracks/useReveal";

const props = defineProps<{ trackId?: number | null; path?: string | null; disabled?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const action = useTrackReveal();
function reveal() {
  if (props.disabled || action.pending.value || (props.trackId == null && !props.path)) return;
  const { trackId, path } = props;
  emit("close");
  void action.reveal(trackId, path);
}
</script>

<template>
  <button
    class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    role="menuitem"
    type="button"
    :disabled="props.disabled || action.pending.value || (props.trackId == null && !props.path)"
    @click.stop="reveal"
  >
    {{ t("在文件资源管理器中显示") }}
  </button>
</template>

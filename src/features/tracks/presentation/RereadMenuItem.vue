<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { useTrackReread } from "@/features/tracks/useReread";

const props = defineProps<{ trackIds: readonly number[]; disabled?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const action = useTrackReread();
function reread() {
  if (props.disabled || action.pending.value || !props.trackIds.length) return;
  const ids = [...props.trackIds];
  emit("close");
  void action.reread(ids);
}
</script>

<template>
  <button
    class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    role="menuitem"
    type="button"
    :disabled="props.disabled || action.pending.value || !props.trackIds.length"
    @click.stop="reread"
  >
    {{ action.pending.value ? t("正在读取标签…") : t("重新读取标签") }}
  </button>
</template>

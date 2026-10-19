<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { useLoudness } from "@/features/loudness/useLoudness";

const props = withDefaults(
  defineProps<{ trackIds: readonly number[]; paths?: readonly string[]; disabled?: boolean }>(),
  { paths: () => [] },
);
const emit = defineEmits<{ close: [] }>();
const action = useLoudness();
function restore() {
  if (props.disabled || action.pending.value || (!props.trackIds.length && !props.paths.length))
    return;
  const ids = [...props.trackIds];
  const paths = [...props.paths];
  emit("close");
  void action.restore(ids, paths);
}
</script>

<template>
  <button
    class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
    role="menuitem"
    type="button"
    :disabled="
      props.disabled || action.pending.value || (!props.trackIds.length && !props.paths.length)
    "
    @click.stop="restore"
  >
    {{ action.pending.value ? t("正在恢复原始响度…") : t("恢复原始响度") }}
  </button>
</template>

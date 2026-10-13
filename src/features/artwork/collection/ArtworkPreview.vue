<template>
  <div :class="{ 'space-y-2': !$slots.details }">
    <div class="flex aspect-square items-center justify-center overflow-hidden bg-black/20">
      <img v-if="url" :src="url" :alt="t('封面')" class="size-full object-contain" />
      <span v-else role="status" class="text-app-muted text-sm">{{
        selection.mixed
          ? t("多个值")
          : status === "loading"
            ? t("封面加载中…")
            : status === "error"
              ? t("读取封面失败，请查看日志")
              : t("暂无封面")
      }}</span>
    </div>
    <slot name="details"></slot>
    <slot
      v-if="exportable"
      name="actions"
      :save="exportPicture"
      :disabled="disabled || status !== 'ready' || transferring || selection.mixed"
    >
      <button
        type="button"
        :disabled="disabled || status !== 'ready' || transferring || selection.mixed"
        class="focus-visible:outline-app-accent w-full rounded-sm border border-white/15 bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="exportPicture"
      >
        {{ t("保存封面") }}
      </button>
    </slot>
    <p v-if="error" role="alert" class="col-span-full text-sm text-red-400">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onScopeDispose, watch } from "vue";
import { t } from "@/shared/i18n/locale";
import type { DisplaySelection } from "@/features/artwork/collection/types";
import { usePicture } from "@/features/artwork/collection/usePicture";
import { saveCover } from "@/features/artwork/transfer";
const props = withDefaults(
  defineProps<{ selection: DisplaySelection; disabled?: boolean; exportable?: boolean }>(),
  { disabled: false, exportable: false },
);
const emit = defineEmits<{ failed: [error: unknown] }>();
const { url, data, status, error } = usePicture(() =>
  props.selection.mixed ? null : props.selection.picture,
);
const transferring = ref(false);
let generation = 0;
watch(
  () => [props.selection, props.disabled],
  () => {
    ++generation;
  },
  { flush: "sync" },
);
onScopeDispose(() => {
  ++generation;
});
async function exportPicture() {
  if (props.disabled || props.selection.mixed || transferring.value || !data.value) return;
  const current = generation;
  const snapshot = [...data.value];
  transferring.value = true;
  try {
    await saveCover(snapshot, () => current === generation);
  } catch (failure) {
    if (current === generation) emit("failed", failure);
  } finally {
    transferring.value = false;
  }
}
</script>

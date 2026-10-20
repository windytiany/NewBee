<template>
  <div :class="{ 'space-y-2': !$slots.details }">
    <div
      ref="pictureElement"
      class="flex aspect-square items-center justify-center overflow-hidden bg-black/20"
      :tabindex="exportMenu && exportable ? 0 : undefined"
      :aria-haspopup="exportMenu && exportable ? 'menu' : undefined"
      :aria-expanded="exportMenu && exportable ? !!contextMenu : undefined"
      @contextmenu="openContextMenu"
      @keydown="onPictureKeydown"
    >
      <img v-if="url" :src="url" :alt="t('封面')" class="size-full object-contain" />
      <span v-else role="status" class="text-app-muted text-sm">{{
        selection.mixed
          ? t("多个值")
          : status === "loading"
            ? t("封面加载中…")
            : status === "error"
              ? t("读取封面失败")
              : t("暂无封面")
      }}</span>
    </div>
    <slot name="details"></slot>
    <slot
      v-if="exportable && !exportMenu"
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
    <div
      v-if="contextMenu"
      ref="menuElement"
      role="menu"
      :aria-label="t('封面')"
      class="bg-app-interactive fixed z-100 w-40 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      @pointerdown.stop
    >
      <button
        type="button"
        role="menuitem"
        :disabled="disabled || status !== 'ready' || transferring || selection.mixed"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40"
        @click="saveFromMenu"
      >
        {{ t("保存封面") }}
      </button>
    </div>
    <p v-if="error" role="alert" class="col-span-full text-sm text-red-400">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onScopeDispose, watch } from "vue";
import { t } from "@/shared/i18n/locale";
import type { DisplaySelection } from "@/features/artwork/collection/types";
import { usePicture } from "@/features/artwork/collection/usePicture";
import { saveCover } from "@/features/artwork/transfer";
import { useContextMenu } from "@/shared/interaction/useContextMenu";
const props = withDefaults(
  defineProps<{
    selection: DisplaySelection;
    disabled?: boolean;
    exportable?: boolean;
    exportMenu?: boolean;
  }>(),
  { disabled: false, exportable: false, exportMenu: false },
);
const emit = defineEmits<{ failed: [error: unknown] }>();
const { url, data, status, error } = usePicture(() =>
  props.selection.mixed ? null : props.selection.picture,
);
const transferring = ref(false);
const pictureElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const menuElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const {
  request: contextMenu,
  position: menuPosition,
  open: openMenu,
  close: closeMenu,
} = useContextMenu<null>({
  menuElement,
  fallbackFocusElement: pictureElement,
});
function openContextMenu(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (!props.exportMenu || !props.exportable) return;
  event.preventDefault();
  event.stopPropagation();
  if (props.disabled || !pictureElement.value) return;
  openMenu({ x: event.clientX, y: event.clientY, trigger: pictureElement.value, payload: null });
}
function onPictureKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (!props.exportMenu || !props.exportable || props.disabled || !pictureElement.value) return;
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = pictureElement.value.getBoundingClientRect();
  openMenu({ x: bounds.left, y: bounds.bottom, trigger: pictureElement.value, payload: null });
}
function saveFromMenu() {
  closeMenu(true);
  return exportPicture();
}
let generation = 0;
watch(
  () => [props.selection, props.disabled],
  () => {
    ++generation;
    closeMenu();
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

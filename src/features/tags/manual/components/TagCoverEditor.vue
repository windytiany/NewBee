<template>
  <div class="relative">
    <div
      ref="coverElement"
      role="button"
      aria-label="封面操作"
      aria-haspopup="menu"
      :aria-expanded="!!contextMenu"
      :aria-disabled="props.disabled"
      :tabindex="props.disabled ? -1 : 0"
      class="focus-visible:outline-app-accent h-full w-full overflow-hidden rounded-md focus-visible:outline-2"
      @contextmenu.prevent.stop="openContextMenu"
      @keydown="onKeydown"
    >
      <img v-if="previewUrl" :src="previewUrl" alt="" class="h-full w-full object-cover" />
      <TrackArtwork
        v-else-if="props.cover === null && props.trackId !== null"
        :track-id="props.trackId"
        class="h-full w-full"
        alt=""
      >
        <div class="bg-app-interactive h-full w-full"></div>
      </TrackArtwork>
      <div v-else class="bg-app-interactive h-full w-full"></div>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      hidden
      :disabled="props.disabled"
      @change="replaceCover"
    />
    <div
      v-if="contextMenu"
      ref="menuElement"
      role="menu"
      aria-label="封面操作"
      class="bg-app-interactive fixed z-100 w-40 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      @pointerdown.stop
    >
      <button
        ref="firstMenuItemElement"
        type="button"
        role="menuitem"
        :disabled="props.disabled"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
        @click.stop="selectCover"
      >
        替换封面
      </button>
      <button
        type="button"
        role="menuitem"
        :disabled="props.disabled"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
        @click.stop="removeCover"
      >
        移除封面
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";
import TrackArtwork from "@/features/artwork/components/TrackArtwork.vue";
import type { CoverEdit } from "@/features/tags/types";
import { useContextMenu } from "@/shared/interaction/useContextMenu";

const props = defineProps<{
  trackId: number | null;
  cover: CoverEdit | null;
  disabled: boolean;
}>();
const emit = defineEmits<{
  change: [cover: CoverEdit];
  failed: [error: unknown];
}>();
const coverElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const fileInput = ref<InstanceType<typeof globalThis.HTMLInputElement> | null>(null);
const menuElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const firstMenuItemElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const previewUrl = ref<string | null>(null);
const {
  request: contextMenu,
  position: menuPosition,
  open: openMenu,
  close: closeMenu,
} = useContextMenu<null>({
  menuElement,
  firstMenuItemElement,
  fallbackFocusElement: coverElement,
});
const MAX_COVER_BYTES = 20 * 1024 * 1024;
let generation = 0;

watch(
  () => [props.trackId, props.cover, props.disabled],
  () => {
    ++generation;
    closeMenu();
  },
  { flush: "sync" },
);
watch(
  () => props.cover,
  (cover) => {
    releasePreview();
    if (cover?.action === "replace") {
      previewUrl.value = globalThis.URL.createObjectURL(
        new globalThis.Blob([new Uint8Array(cover.data)]),
      );
    }
  },
  { immediate: true },
);
onScopeDispose(() => {
  ++generation;
  releasePreview();
});

function releasePreview() {
  if (previewUrl.value) globalThis.URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = null;
}
function openContextMenu(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (props.disabled || !coverElement.value) return;
  openMenu({ x: event.clientX, y: event.clientY, trigger: coverElement.value, payload: null });
}
function onKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (props.disabled || !coverElement.value) return;
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  const bounds = coverElement.value.getBoundingClientRect();
  openMenu({ x: bounds.left, y: bounds.bottom, trigger: coverElement.value, payload: null });
}
function selectCover() {
  closeMenu(true);
  if (!props.disabled) fileInput.value?.click();
}
function removeCover() {
  closeMenu(true);
  if (props.disabled) return;
  ++generation;
  emit("change", { action: "delete" });
}
async function replaceCover(event: InstanceType<typeof globalThis.Event>) {
  const input = event.target as InstanceType<typeof globalThis.HTMLInputElement>;
  const file = input.files?.[0];
  input.value = "";
  if (props.disabled || !file) return;
  const requestGeneration = ++generation;
  if (!file.size || file.size > MAX_COVER_BYTES) {
    emit("failed", new Error("封面为空或超过 20 MiB。"));
    return;
  }
  try {
    const data = Array.from(new Uint8Array(await file.arrayBuffer()));
    if (requestGeneration === generation) emit("change", { action: "replace", data });
  } catch (error) {
    if (requestGeneration === generation) emit("failed", error);
  }
}
</script>

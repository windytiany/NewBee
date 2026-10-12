<script setup lang="ts">
import type { ItemSelectionModifiers } from "@/shared/interaction/item/useSelection";
import TrackFields from "@/features/tracks/presentation/TrackFields.vue";
const props = defineProps<{
  itemKey: string;
  track: {
    title: string | null;
    artist: string | null;
    album: string | null;
    durationMs: number | null;
  };
  number: number;
  focused: boolean;
  selected: boolean;
  current: boolean;
  menuOpen: boolean;
  menuId: string;
}>();
const emit = defineEmits<{
  select: [modifiers: ItemSelectionModifiers];
  play: [];
  contextMenu: [
    request: { itemKey: string; x: number; y: number; trigger: globalThis.HTMLButtonElement },
  ];
}>();
function mousedown(event: globalThis.MouseEvent) {
  if (event.button === 0) event.preventDefault();
}
function select(event: globalThis.MouseEvent) {
  if (event.button !== 0) return;
  emit("select", { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
  (event.currentTarget as globalThis.HTMLButtonElement).focus({ preventScroll: true });
}
function context(event: globalThis.MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  emit("contextMenu", {
    itemKey: props.itemKey,
    x: event.clientX,
    y: event.clientY,
    trigger: event.currentTarget as globalThis.HTMLButtonElement,
  });
}
function keydown(event: globalThis.KeyboardEvent) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  event.stopPropagation();
  const trigger = event.currentTarget as globalThis.HTMLButtonElement;
  const bounds = trigger.getBoundingClientRect();
  emit("contextMenu", { itemKey: props.itemKey, x: bounds.left, y: bounds.bottom, trigger });
}
</script>

<template>
  <li class="relative border-b border-white/5">
    <button
      data-item-interaction
      data-track-select
      type="button"
      class="focus-visible:bg-app-track grid w-full grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm transition-colors outline-none sm:grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1fr)_3rem]"
      :class="focused ? 'bg-app-track' : selected ? 'bg-white/10' : 'hover:bg-white/5'"
      :aria-pressed="selected ? true : undefined"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      :aria-controls="menuOpen ? menuId : undefined"
      @mousedown="mousedown"
      @click="select"
      @dblclick="emit('play')"
      @contextmenu="context"
      @keydown="keydown"
    >
      <span class="text-app-muted w-full text-right text-xs tabular-nums">{{ number }}</span>
      <TrackFields :track="track" :current="current" />
    </button>
  </li>
</template>

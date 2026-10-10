<template>
  <li :data-playlist-item-id="track.playlistItemId" class="relative border-b border-white/5">
    <span
      v-if="dropPosition"
      aria-hidden="true"
      class="bg-app-accent pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full"
      :class="dropPosition === 'before' ? 'top-0' : 'bottom-0'"
    ></span>
    <div
      class="grid w-full grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-3 rounded-md px-1 transition-colors sm:grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1fr)_3rem]"
      :class="isFocused ? 'bg-app-track' : isSelected ? 'bg-white/10' : 'hover:bg-white/5'"
    >
      <button
        data-item-interaction
        :aria-label="t('拖动重排第 {count} 首', { count: trackNumber })"
        :disabled="isDragDisabled"
        class="text-app-muted focus-visible:bg-app-track grid h-full min-h-10 w-full touch-none place-items-center rounded-sm transition-colors outline-none select-none disabled:cursor-not-allowed disabled:opacity-40"
        :class="isDragging ? 'text-app-accent cursor-grabbing' : 'cursor-grab hover:text-white'"
        type="button"
        @pointerdown.stop="emit('reorderPointerDown', track.playlistItemId, $event)"
        @click.stop.prevent
        @dblclick.stop.prevent
      >
        <span class="w-full text-right text-xs tabular-nums">{{ trackNumber }}</span>
      </button>
      <button
        data-item-interaction
        data-playlist-track-select
        class="focus-visible:bg-app-track col-start-2 -col-end-1 grid w-full grid-cols-[minmax(0,1fr)_3rem] items-center gap-3 rounded-md py-2.5 pl-0 text-left text-sm transition-colors outline-none sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_3rem]"
        :class="isDragging ? 'cursor-grabbing' : 'cursor-grab'"
        :aria-pressed="isSelected ? true : undefined"
        aria-haspopup="menu"
        :aria-expanded="isContextMenuOpen"
        :aria-controls="isContextMenuOpen ? 'playlist-track-context-menu' : undefined"
        type="button"
        @pointerdown="handleReorderPointerDown"
        @click="handleSelect"
        @dblclick="emit('play')"
        @contextmenu="openTrackContextMenu"
        @keydown="handleContextMenuKeydown"
      >
        <span class="flex min-w-0 flex-col gap-0.5">
          <span
            class="truncate font-medium"
            :class="isCurrentTrack ? 'text-app-accent' : 'text-white'"
          >
            {{ track.title ?? t("未知曲目") }}
          </span>
          <span class="text-app-muted truncate text-xs">{{ track.artist ?? t("未知艺术家") }}</span>
        </span>
        <span class="text-app-muted hidden truncate text-xs sm:block">
          {{ track.album ?? t("未知专辑") }}
        </span>
        <span class="text-app-muted text-right text-xs tabular-nums">{{ duration }}</span>
      </button>
    </div>
  </li>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed } from "vue";
import type { ItemSelectionModifiers } from "@/shared/interaction/useItemSelection";
import { formatTrackDuration } from "@/features/library/format";
import type { PlaylistTrackSummary } from "@/features/playlist/types";

const props = withDefaults(
  defineProps<{
    track: PlaylistTrackSummary;
    trackNumber: number;
    isFocused: boolean;
    isSelected: boolean;
    isCurrentTrack: boolean;
    isContextMenuOpen?: boolean;
    isDragDisabled?: boolean;
    isDragging?: boolean;
    dropPosition?: "before" | "after" | null;
  }>(),
  {
    isContextMenuOpen: false,
    isDragDisabled: false,
    isDragging: false,
    dropPosition: null,
  },
);

const duration = computed(() => formatTrackDuration(props.track.durationMs) ?? t("时长未知"));

const emit = defineEmits<{
  select: [modifiers: ItemSelectionModifiers];
  play: [];
  reorderPointerDown: [playlistItemId: number, event: InstanceType<typeof globalThis.PointerEvent>];
  contextMenu: [
    request: {
      playlistItemId: number;
      x: number;
      y: number;
      trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
    },
  ];
}>();

function handleSelect(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (event.button !== 0) return;
  emit("select", { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
}

function handleReorderPointerDown(event: InstanceType<typeof globalThis.PointerEvent>) {
  if (event.pointerType === "touch") return;
  emit("reorderPointerDown", props.track.playlistItemId, event);
}

function openTrackContextMenu(event: InstanceType<typeof globalThis.MouseEvent>) {
  event.preventDefault();
  event.stopPropagation();
  emit("contextMenu", {
    playlistItemId: props.track.playlistItemId,
    x: event.clientX,
    y: event.clientY,
    trigger: event.currentTarget as InstanceType<typeof globalThis.HTMLButtonElement>,
  });
}

function handleContextMenuKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;

  event.preventDefault();
  event.stopPropagation();
  const trigger = event.currentTarget as InstanceType<typeof globalThis.HTMLButtonElement>;
  const bounds = trigger.getBoundingClientRect();
  emit("contextMenu", {
    playlistItemId: props.track.playlistItemId,
    x: bounds.left,
    y: bounds.bottom,
    trigger,
  });
}
</script>

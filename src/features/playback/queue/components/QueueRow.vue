<template>
  <li ref="rowElement" :aria-current="isCurrentTrack ? 'true' : undefined">
    <button
      data-item-interaction
      class="focus-visible:bg-app-track flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors outline-none"
      :class="isFocused ? 'bg-app-track' : isSelected ? 'bg-white/10' : 'hover:bg-white/5'"
      :aria-pressed="isSelected ? true : undefined"
      :aria-haspopup="props.canRemoveFromQueue ? 'menu' : undefined"
      :aria-expanded="props.canRemoveFromQueue ? props.isContextMenuOpen : undefined"
      type="button"
      @click="handleTrackClick"
      @dblclick="handleTrackDoubleClick"
      @contextmenu="openQueueContextMenu"
      @keydown="handleContextMenuKeydown"
    >
      <span
        aria-hidden="true"
        class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-sm"
      >
        <img
          v-if="artworkUrl"
          :src="artworkUrl"
          alt=""
          class="size-full object-cover transition-opacity"
          :class="artworkStatus === 'ready' ? 'opacity-100' : 'opacity-0'"
        />
        <Disc3 v-else-if="artworkStatus === 'fallback'" class="size-5 text-sky-200/80" />
      </span>
      <AudioLines
        v-if="isCurrentTrack"
        aria-hidden="true"
        class="text-app-accent size-4 shrink-0"
      />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          class="truncate text-sm font-medium"
          :class="isCurrentTrack ? 'text-app-accent' : 'text-white'"
        >
          {{ title }}
        </span>
        <span class="text-app-muted truncate text-xs">{{ album }}</span>
      </span>
      <span
        v-if="props.isSkipped"
        role="img"
        class="text-app-muted shrink-0"
        title="自动播放时跳过，双击仍可播放"
        aria-label="自动播放时跳过，双击仍可播放"
      >
        <SkipForward aria-hidden="true" class="size-3.5" />
      </span>
      <span class="text-app-muted shrink-0 pl-1 text-xs tabular-nums">{{ duration }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { AudioLines, Disc3, SkipForward } from "@lucide/vue";
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { ItemSelectionModifiers } from "@/shared/interaction/useItemSelection";
import { useTrackArtwork } from "@/features/artwork/useTrackArtwork";

const props = withDefaults(
  defineProps<{
    trackId: number;
    rowKey: string;
    title: string;
    album: string;
    duration: string;
    isCurrentTrack?: boolean;
    isSkipped?: boolean;
    isSelected?: boolean;
    isFocused: boolean;
    canRemoveFromQueue?: boolean;
    isContextMenuOpen?: boolean;
  }>(),
  {
    isCurrentTrack: false,
    isSkipped: false,
    isSelected: false,
    canRemoveFromQueue: false,
    isContextMenuOpen: false,
  },
);

const emit = defineEmits<{
  select: [modifiers: ItemSelectionModifiers];
  play: [];
  contextMenu: [
    request: {
      rowKey: string;
      x: number;
      y: number;
      trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
    },
  ];
}>();

function handleTrackClick(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (event.button === 0) {
    emit("select", { ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
  }
}

function handleTrackDoubleClick(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (event.button === 0) emit("play");
}

function openQueueContextMenu(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (!props.canRemoveFromQueue) return;

  event.preventDefault();
  event.stopPropagation();
  emit("contextMenu", {
    rowKey: props.rowKey,
    x: event.clientX,
    y: event.clientY,
    trigger: event.currentTarget as InstanceType<typeof globalThis.HTMLButtonElement>,
  });
}

function handleContextMenuKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (
    !props.canRemoveFromQueue ||
    (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey))
  ) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const trigger = event.currentTarget as InstanceType<typeof globalThis.HTMLButtonElement>;
  const bounds = trigger.getBoundingClientRect();
  emit("contextMenu", {
    rowKey: props.rowKey,
    x: bounds.left,
    y: bounds.bottom,
    trigger,
  });
}

const rowElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const visible = ref(false);
const { url: artworkUrl, status: artworkStatus } = useTrackArtwork(
  () => (visible.value ? props.trackId : null),
  "thumbnail",
);
let observer: InstanceType<typeof globalThis.IntersectionObserver> | null = null;

onMounted(() => {
  if (!globalThis.IntersectionObserver) {
    visible.value = true;
    return;
  }
  observer = new globalThis.IntersectionObserver((entries) => {
    visible.value = entries.some((entry) => entry.isIntersecting);
  });
  if (rowElement.value) observer.observe(rowElement.value);
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <li ref="rowElement" :aria-current="isCurrentTrack ? 'true' : undefined">
    <button
      data-item-interaction
      data-keyboard-item
      class="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors outline-none"
      :class="isSelected ? 'bg-app-track' : 'hover:bg-white/5'"
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
        <Disc3
          v-else-if="artworkActivated && artworkStatus === 'fallback'"
          class="size-5 text-sky-200/80"
        />
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
          {{ display.title }}
        </span>
        <span class="text-app-muted truncate text-xs">{{ display.album }}</span>
      </span>
      <span
        v-if="props.isSkipped"
        role="img"
        class="text-app-muted shrink-0"
        :title="t('自动播放时跳过，双击仍可播放')"
        :aria-label="t('自动播放时跳过，双击仍可播放')"
      >
        <SkipForward aria-hidden="true" class="size-3.5" />
      </span>
      <span class="text-app-muted shrink-0 pl-1 text-xs tabular-nums">{{ display.duration }}</span>
    </button>
  </li>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { AudioLines, Disc3, SkipForward } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ItemSelectionModifiers } from "@/shared/interaction/item/useSelection";
import { useTrackArtwork } from "@/features/artwork/track/useArtwork";
import { usePresentation } from "@/features/tracks/presentation/usePresentation";
import { formatTrackDuration } from "@/features/tracks/format";

const props = withDefaults(
  defineProps<{
    trackId: number | null;
    rowKey: string;
    title: string;
    album: string;
    duration: string;
    isCurrentTrack?: boolean;
    isSkipped?: boolean;
    isSelected?: boolean;
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

const presentation = usePresentation(() => props.trackId);
const display = computed(() => {
  if (presentation.value.status === "loading") return { title: "", album: "", duration: "" };
  if (presentation.value.status === "failed")
    return { title: props.title, album: props.album, duration: props.duration };
  const { track } = presentation.value;
  return {
    title: track.title ?? t("未知曲目"),
    album: track.album ?? t("未知专辑"),
    duration: formatTrackDuration(track.durationMs) ?? t("时长未知"),
  };
});
const rowElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const artworkActivated = ref(false);
const { url: artworkUrl, status: artworkStatus } = useTrackArtwork(
  () => (artworkActivated.value ? props.trackId : null),
  () => Math.ceil(40 * (globalThis.devicePixelRatio || 1)),
);
let observer: InstanceType<typeof globalThis.IntersectionObserver> | null = null;

onMounted(() => {
  if (!globalThis.IntersectionObserver) {
    artworkActivated.value = true;
    return;
  }
  observer = new globalThis.IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    artworkActivated.value = true;
    observer?.disconnect();
  });
  if (rowElement.value) observer.observe(rowElement.value);
});

onBeforeUnmount(() => observer?.disconnect());
</script>

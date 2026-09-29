<template>
  <section
    :aria-label="props.title"
    class="bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col text-white"
  >
    <h2
      ref="headingElement"
      class="shrink-0 px-3 py-2 text-sm font-medium text-white/90"
      tabindex="-1"
    >
      {{ props.title }}
    </h2>

    <div class="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
      <p v-if="props.isLoading" class="text-spotify-muted px-2 py-3 text-sm" role="status">
        正在读取曲目…
      </p>
      <p v-else-if="props.error" class="px-2 py-3 text-sm text-red-300" role="alert">
        {{ props.error }}
      </p>
      <p v-else-if="props.tracks.length === 0" class="text-spotify-muted px-2 py-3 text-sm">
        {{ props.emptyMessage }}
      </p>
      <ul v-else ref="listElement" class="space-y-1">
        <TrackListItem
          v-for="track in props.tracks"
          :key="getTrackRowKey(track)"
          :track-id="track.trackId"
          :row-key="getTrackRowKey(track)"
          :can-remove-from-queue="props.canRemoveFromQueue"
          :is-context-menu-open="contextMenu?.rowKey === getTrackRowKey(track)"
          :title="track.title ?? '未知曲目'"
          :album="track.album ?? '未知专辑'"
          :duration="formatTrackDuration(track.durationMs) ?? '时长未知'"
          :is-current-track="getTrackRowKey(track) === props.currentRowKey"
          :is-selected="track.trackId === props.selectedTrackId"
          :is-focused="focusedItem === getTrackFocusKey(getTrackRowKey(track))"
          @select="selectTrack(track.trackId, getTrackRowKey(track))"
          @play="emit('playQueueItem', getTrackRowKey(track))"
          @context-menu="openQueueContextMenu"
        />
      </ul>
    </div>

    <div
      v-if="contextMenu"
      ref="queueContextMenuElement"
      class="bg-spotify-interactive fixed z-100 w-52 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      role="menu"
      aria-label="队列曲目操作"
      @pointerdown.stop
    >
      <button
        ref="removeMenuItemElement"
        class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
        role="menuitem"
        type="button"
        @click.stop="removeContextMenuItem"
      >
        从播放队列移除
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { useClickFocus } from "@/composables/useClickFocus";
import type { PlaybackDisplayTrack } from "@/types/playbackDisplay";
import { formatTrackDuration } from "@/utils/formatTrack";
import TrackListItem from "@/components/track/TrackListItem.vue";

type Track = PlaybackDisplayTrack;

const { focusedItem, setFocusedItem } = useClickFocus();
type QueueContextMenuRequest = {
  rowKey: string;
  x: number;
  y: number;
  trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
};
const headingElement = ref<InstanceType<typeof globalThis.HTMLHeadingElement> | null>(null);
const listElement = ref<InstanceType<typeof globalThis.HTMLUListElement> | null>(null);
const queueContextMenuElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const removeMenuItemElement = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const contextMenu = shallowRef<QueueContextMenuRequest | null>(null);
const menuPosition = ref({ x: 0, y: 0 });

function getTrackRowKey(track: Track) {
  return track.rowKey;
}

function getTrackFocusKey(id: string) {
  return `track:${id}`;
}

const props = withDefaults(
  defineProps<{
    tracks?: readonly Track[];
    currentRowKey?: string | null;
    selectedTrackId?: number | null;
    title?: string;
    isLoading?: boolean;
    error?: string;
    emptyMessage?: string;
    canRemoveFromQueue?: boolean;
  }>(),
  {
    tracks: () => [],
    currentRowKey: null,
    selectedTrackId: null,
    title: "当前曲目列表",
    isLoading: false,
    error: "",
    emptyMessage: "暂无曲目。",
    canRemoveFromQueue: false,
  },
);

const emit = defineEmits<{
  select: [trackId: Track["trackId"]];
  playQueueItem: [rowKey: string];
  removeQueueItem: [rowKey: string];
}>();

function openQueueContextMenu(request: QueueContextMenuRequest) {
  if (!props.canRemoveFromQueue) return;

  const menuWidth = 216;
  const menuHeight = 52;
  menuPosition.value = {
    x: Math.max(0, Math.min(request.x, globalThis.innerWidth - menuWidth)),
    y: Math.max(0, Math.min(request.y, globalThis.innerHeight - menuHeight)),
  };
  contextMenu.value = request;
  void nextTick(() => removeMenuItemElement.value?.focus());
}

function closeQueueContextMenu(restoreFocus: boolean) {
  const trigger = contextMenu.value?.trigger;
  contextMenu.value = null;
  if (!restoreFocus) return;

  void nextTick(() => {
    if (trigger?.isConnected) trigger.focus();
    else headingElement.value?.focus();
  });
}

function closeQueueContextMenuOnOutsidePointer(
  event: InstanceType<typeof globalThis.PointerEvent>,
) {
  if (!contextMenu.value) return;
  if (
    event.target instanceof globalThis.Node &&
    queueContextMenuElement.value?.contains(event.target)
  ) {
    return;
  }
  closeQueueContextMenu(false);
}

function closeQueueContextMenuOnEscape(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (event.key !== "Escape" || !contextMenu.value) return;

  event.preventDefault();
  closeQueueContextMenu(true);
}

function removeContextMenuItem() {
  const rowKey = contextMenu.value?.rowKey;
  if (rowKey === undefined) return;

  const removedIndex = props.tracks.findIndex((track) => track.rowKey === rowKey);
  closeQueueContextMenu(false);
  emit("removeQueueItem", rowKey);

  void nextTick(() => {
    const buttons =
      listElement.value?.querySelectorAll<InstanceType<typeof globalThis.HTMLButtonElement>>(
        ":scope > li > button",
      );
    if (removedIndex >= 0 && buttons?.length) {
      buttons[Math.min(removedIndex, buttons.length - 1)]?.focus();
      return;
    }
    headingElement.value?.focus();
  });
}

watch(
  () => {
    const rowKey = contextMenu.value?.rowKey;
    return rowKey === undefined || props.tracks.some((track) => track.rowKey === rowKey);
  },
  (isRowStillDisplayed) => {
    if (!isRowStillDisplayed) closeQueueContextMenu(true);
  },
);

onMounted(() => {
  globalThis.document.addEventListener("pointerdown", closeQueueContextMenuOnOutsidePointer);
  globalThis.document.addEventListener("keydown", closeQueueContextMenuOnEscape);
});

onUnmounted(() => {
  globalThis.document.removeEventListener("pointerdown", closeQueueContextMenuOnOutsidePointer);
  globalThis.document.removeEventListener("keydown", closeQueueContextMenuOnEscape);
});

function selectTrack(trackId: Track["trackId"], rowKey: string) {
  setFocusedItem(getTrackFocusKey(rowKey));
  emit("select", trackId);
}
</script>

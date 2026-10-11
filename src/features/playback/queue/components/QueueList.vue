<template>
  <section
    :aria-label="displayTitle"
    class="bg-app-base flex h-full min-h-0 w-full min-w-0 flex-col text-white"
  >
    <h2
      ref="headingElement"
      class="shrink-0 px-3 py-2 text-sm font-medium text-white/90"
      tabindex="-1"
    >
      {{ displayTitle }}
    </h2>

    <div v-persistent-scroll="'playback:queue'" class="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
      <p
        v-if="!props.isLoading && props.tracks.length === 0"
        class="text-app-muted px-2 py-3 text-sm"
      >
        {{ displayEmptyMessage }}
      </p>
      <ul
        v-else-if="!props.isLoading"
        ref="listElement"
        class="space-y-1"
        @keydown="keyboard.onKeydown"
        @focusin="keyboard.onFocusin"
      >
        <QueueRow
          v-for="track in props.tracks"
          :key="getTrackRowKey(track)"
          :track-id="track.trackId"
          :is-skipped="props.skippedTrackIds.includes(track.trackId)"
          :row-key="getTrackRowKey(track)"
          :can-remove-from-queue="props.canRemoveFromQueue"
          :is-context-menu-open="contextMenu?.rowKey === getTrackRowKey(track)"
          :title="track.title ?? t('未知曲目')"
          :album="track.album ?? t('未知专辑')"
          :duration="formatTrackDuration(track.durationMs) ?? t('时长未知')"
          :is-current-track="getTrackRowKey(track) === props.currentRowKey"
          :is-selected="queueFocus.isSelected(getTrackRowKey(track))"
          :is-focused="queueFocus.isFocused(getTrackRowKey(track))"
          @select="selectTrack(getTrackRowKey(track), $event)"
          @play="emit('playQueueItem', getTrackRowKey(track))"
          @context-menu="openQueueContextMenu"
        />
      </ul>
    </div>

    <div
      v-if="contextMenu"
      ref="queueContextMenuElement"
      data-item-interaction
      class="bg-app-interactive fixed z-100 w-52 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      role="menu"
      :aria-label="t('队列曲目操作')"
      @pointerdown.stop
    >
      <button
        ref="removeMenuItemElement"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
        role="menuitem"
        type="button"
        @click.stop="removeContextMenuItem"
      >
        {{ t("从播放队列移除") }}
      </button>
      <EditMenuItem :track-ids="contextTargetTrackIds" @close="closeQueueContextMenu(true)" />
      <SkipMenuItem :track-ids="contextTargetTrackIds" @close="closeQueueContextMenu(true)" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { useItemSelection } from "@/shared/interaction/item/useSelection";
import { vPersistentScroll } from "@/shared/interaction/scroll/persistence";
import { createItemKeyboard } from "@/shared/interaction/item/keyboard";
import type { ItemSelectionModifiers } from "@/shared/interaction/item/useSelection";
import type { PlaybackDisplayTrack } from "@/features/playback/types";
import { formatTrackDuration } from "@/features/library/format";
import QueueRow from "@/features/playback/queue/components/QueueRow.vue";
import SkipMenuItem from "@/features/playback/queue/components/SkipMenuItem.vue";
import EditMenuItem from "@/features/tags/manual/components/EditMenuItem.vue";

type Track = PlaybackDisplayTrack;

const queueFocus = useItemSelection("playback:queue");
type QueueContextMenuTrigger = {
  rowKey: string;
  x: number;
  y: number;
  trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
};

type QueueContextMenuRequest = QueueContextMenuTrigger & { targetRowKeys: string[] };
const headingElement = ref<InstanceType<typeof globalThis.HTMLHeadingElement> | null>(null);
const listElement = ref<InstanceType<typeof globalThis.HTMLUListElement> | null>(null);
const queueContextMenuElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const removeMenuItemElement = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const contextMenu = shallowRef<QueueContextMenuRequest | null>(null);
const menuPosition = ref({ x: 0, y: 0 });

function getTrackRowKey(track: Track) {
  return track.rowKey;
}

const props = withDefaults(
  defineProps<{
    tracks?: readonly Track[];
    currentRowKey?: string | null;
    title?: string;
    isLoading?: boolean;
    emptyMessage?: string;
    canRemoveFromQueue?: boolean;
    skippedTrackIds?: readonly number[];
  }>(),
  {
    tracks: () => [],
    currentRowKey: null,
    title: undefined,
    isLoading: false,
    emptyMessage: undefined,
    canRemoveFromQueue: false,
    skippedTrackIds: () => [],
  },
);

const displayTitle = computed(() => props.title ?? t("当前曲目列表"));
const displayEmptyMessage = computed(() => props.emptyMessage ?? t("暂无曲目。"));

const visibleRowKeys = computed(() => props.tracks.map(getTrackRowKey));
const contextTargetTrackIds = computed(() => {
  const rowKeys = new Set(contextMenu.value?.targetRowKeys ?? []);
  return props.tracks.filter((track) => rowKeys.has(track.rowKey)).map((track) => track.trackId);
});

watch(visibleRowKeys, (rowKeys) => queueFocus.syncVisibleItems(rowKeys), { immediate: true });

const emit = defineEmits<{
  playQueueItem: [rowKey: string];
  removeQueueItems: [rowKeys: string[]];
}>();

const keyboard = createItemKeyboard({
  getItemKeys: () => visibleRowKeys.value,
  itemSelector: "button[data-item-interaction]",
  onFocus: (key) => {
    if (!queueFocus.isFocused(key)) queueFocus.focusItem(key);
  },
  onMove: (key, event) => selectTrack(key, event),
  onActivate: (key) => emit("playQueueItem", key),
});

function openQueueContextMenu(request: QueueContextMenuTrigger) {
  if (!props.canRemoveFromQueue) return;

  const menuWidth = 216;
  const menuHeight = 132;
  menuPosition.value = {
    x: Math.max(0, Math.min(request.x, globalThis.innerWidth - menuWidth)),
    y: Math.max(0, Math.min(request.y, globalThis.innerHeight - menuHeight)),
  };
  const targetRowKeys = queueFocus.contextMenuTargets(request.rowKey, visibleRowKeys.value);
  if (targetRowKeys.length === 0) return;
  contextMenu.value = { ...request, targetRowKeys };
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
  const targetRowKeys = contextMenu.value?.targetRowKeys;
  if (!targetRowKeys?.length) return;

  const targetRows = new Set(targetRowKeys);
  const removedIndex = props.tracks.findIndex((track) => targetRows.has(track.rowKey));
  closeQueueContextMenu(false);
  emit("removeQueueItems", targetRowKeys);

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
    const rowKeys = contextMenu.value?.targetRowKeys;
    return (
      rowKeys === undefined ||
      rowKeys.every((rowKey) => props.tracks.some((track) => track.rowKey === rowKey))
    );
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

function selectTrack(rowKey: string, modifiers: ItemSelectionModifiers) {
  queueFocus.selectItem(rowKey, visibleRowKeys.value, modifiers);
}
</script>

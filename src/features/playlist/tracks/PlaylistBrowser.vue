<template>
  <section
    data-focus-region
    :data-local-drop="props.playlist ? 'playlist' : undefined"
    :data-playlist-id="props.playlist?.id"
    :aria-label="t('播放列表浏览')"
    class="sidebar-scrollbars bg-app-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-white"
  >
    <template v-if="props.playlist">
      <header
        class="from-app-accent/20 via-app-accent/5 to-app-base shrink-0 bg-linear-to-b px-5 py-6 sm:px-8 sm:py-8"
      >
        <div class="flex items-end gap-5">
          <TrackArtwork
            :track-id="props.coverTrackId"
            :pending="props.isCoverPending"
            alt=""
            class="size-28 shrink-0 rounded-md sm:size-36"
          >
            <PlaylistPlaceholder />
          </TrackArtwork>
          <div class="min-w-0 flex-1 pb-1">
            <p class="mb-2 text-xs font-semibold tracking-wide text-white/75 uppercase">
              {{ t("播放列表") }}
            </p>
            <h1
              id="playlist-browser-heading"
              ref="playlistHeadingElement"
              class="truncate text-2xl leading-normal font-bold tracking-tight sm:text-4xl"
              tabindex="-1"
            >
              {{ props.playlist.name }}
            </h1>
          </div>
          <button
            :aria-label="t('播放歌单')"
            class="focus-visible:outline-app-accent bg-app-accent text-app-on-accent grid size-11 shrink-0 place-items-center rounded-full transition-transform focus-visible:outline-2"
            :class="
              props.isLoadingTracks || props.tracks.length === 0
                ? 'cursor-not-allowed opacity-50'
                : 'hover:scale-105 active:scale-95'
            "
            :disabled="props.isLoadingTracks || props.tracks.length === 0"
            :title="t('播放歌单')"
            type="button"
            @click="emit('playPlaylist', visiblePlaylistItemIds)"
          >
            <Play aria-hidden="true" class="ml-0.5 size-5 fill-current" />
          </button>
        </div>
      </header>

      <div
        ref="trackScrollContainerElement"
        v-persistent-scroll="JSON.stringify(['playlist', props.playlist?.id])"
        class="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-8"
        :style="tableStyle"
      >
        <TableHeader
          :columns="columns"
          :sort="table.sort.value"
          class="sticky top-0 z-10 px-4"
          @sort="table.toggle"
          @resize="table.resize"
        />

        <p
          v-if="
            !props.isLoadingTracks &&
            !props.playlistsError &&
            !props.tracksError &&
            props.tracks.length === 0
          "
          class="text-app-muted py-4 text-sm"
        >
          {{ t("无曲目") }}
        </p>
        <ol
          v-else-if="!props.isLoadingTracks && !props.playlistsError && !props.tracksError"
          ref="trackListElement"
          data-keyboard-list
          @keydown="keyboard.onKeydown"
          @focusin="keyboard.onFocusin"
        >
          <PlaylistTrack
            v-for="(track, index) in sortedTracks"
            :key="track.playlistItemId"
            :track="track"
            :track-number="trackNumbers.get(track.playlistItemId) ?? 0"
            :is-selected="playlistTrackFocus.isSelected(String(track.playlistItemId))"
            :is-current-track="props.currentRowKey === getTrackRowKey(track.playlistItemId)"
            :is-context-menu-open="contextMenu?.payload.itemKey === String(track.playlistItemId)"
            :is-drag-disabled="
              !naturalOrder || props.isLoadingTracks || props.isPlaylistActionPending
            "
            :is-dragging="dragPreview?.movingItemIds.includes(track.playlistItemId) ?? false"
            :drop-position="getTrackDropPosition(track.playlistItemId, index)"
            @select="selectTrack(track.playlistItemId, $event)"
            @play="emit('playTrack', track.playlistItemId, visiblePlaylistItemIds)"
            @context-menu="openTrackContextMenu"
            @reorder-pointer-down="beginTrackReorder"
          />
        </ol>
      </div>

      <div
        v-if="contextMenu"
        id="playlist-track-context-menu"
        ref="contextMenuElement"
        data-item-interaction
        class="bg-app-interactive fixed z-100 w-56 rounded-md p-1 shadow-xl ring-1 ring-white/10"
        :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
        role="menu"
        :aria-label="t('歌单条目操作')"
        @pointerdown.stop
      >
        <button
          class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
          role="menuitem"
          :disabled="props.isPlaylistActionPending"
          type="button"
          @click.stop="addToNext"
        >
          {{ t("添加为下一首") }}
        </button>
        <button
          class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
          role="menuitem"
          :disabled="props.isPlaylistActionPending"
          type="button"
          @click.stop="addToQueueEnd"
        >
          {{ t("添加到队尾") }}
        </button>
        <SkipMenuItem
          :track-ids="contextTargetTrackIds"
          :disabled="props.isPlaylistActionPending"
          @close="closeContextMenu(true)"
        />
        <div class="my-1 border-t border-white/10" role="separator"></div>
        <AppendMenuItem
          :track-ids="contextTargetTrackIds"
          :disabled="props.isPlaylistActionPending"
          @create="createPlaylistWithTracks"
          @close="closeContextMenu(true)"
        />
        <ImportMenuItem
          :track-ids="contextTargetTrackIds"
          :disabled="props.isPlaylistActionPending"
          @close="closeContextMenu(true)"
        />
        <div class="my-1 border-t border-white/10" role="separator"></div>
        <EditMenuItem
          :track-ids="contextTargetTrackIds"
          :disabled="props.isPlaylistActionPending"
          @close="closeContextMenu(true)"
        />
        <ReleaseMenuItem
          :track-ids="contextTargetTrackIds"
          :disabled="props.isPlaylistActionPending"
          @close="closeContextMenu(true)"
        />
        <UpdateMenuItem :disabled="props.isPlaylistActionPending">
          <DownloadMenuItem
            :track-ids="contextTargetTrackIds"
            :disabled="props.isPlaylistActionPending"
            @close="closeContextMenu(true)"
          />
          <AnalysisMenuItem
            :track-ids="contextTargetTrackIds"
            :disabled="props.isPlaylistActionPending"
            @close="closeContextMenu(true)"
          />
          <RemovalMenuItem
            :track-ids="contextTargetTrackIds"
            :disabled="props.isPlaylistActionPending"
            @close="closeContextMenu(true)"
          />
          <RereadMenuItem
            :track-ids="contextTargetTrackIds"
            :disabled="props.isPlaylistActionPending"
            @close="closeContextMenu(true)"
          />
        </UpdateMenuItem>
        <div class="my-1 border-t border-white/10" role="separator"></div>
        <button
          class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-red-200 hover:bg-white/10 focus-visible:outline-2"
          role="menuitem"
          :disabled="props.isPlaylistActionPending"
          type="button"
          @click.stop="removeFromPlaylist"
        >
          {{ t("从当前歌单移除") }}
        </button>
      </div>
      <div
        v-if="dragPreview"
        data-playlist-drag-preview
        aria-hidden="true"
        class="bg-app-interactive pointer-events-none fixed z-100 grid size-9 place-items-center rounded-md text-white shadow-xl ring-1 ring-white/20"
        :style="{ left: `${dragPreview.clientX + 10}px`, top: `${dragPreview.clientY + 10}px` }"
      >
        <Files aria-hidden="true" class="text-app-accent size-5" />
        <span
          class="bg-app-accent text-app-on-accent absolute -top-1 -right-1 grid min-h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-bold"
        >
          {{ dragPreview.movingItemIds.length }}
        </span>
      </div>
    </template>

    <div v-else class="grid min-h-0 flex-1 place-items-center px-5 text-center">
      <p
        v-if="!props.isLoadingPlaylists && !props.playlistsError && !props.hasPlaylists"
        class="text-app-muted text-sm"
      >
        {{ t("无歌单") }}
      </p>
      <p
        v-else-if="!props.isLoadingPlaylists && !props.playlistsError"
        class="text-app-muted text-sm"
      >
        {{ t("请选择歌单") }}
      </p>
    </div>
    <CreatePlaylistDialog ref="createPlaylistDialog" @created="reportPlaylistChanged" />
  </section>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { Files, Play } from "@lucide/vue";
import PlaylistPlaceholder from "@/features/playlist/artwork/PlaylistPlaceholder.vue";
import { useContextMenu } from "@/shared/interaction/useContextMenu";
import { useItemSelection } from "@/shared/interaction/item/useSelection";
import { vPersistentScroll } from "@/shared/interaction/scroll/persistence";
import { createItemKeyboard } from "@/shared/interaction/item/keyboard";
import { useContextCommands } from "@/features/shortcuts/context";
import { createPlaylistDragReorder } from "@/features/playlist/ordering/drag";
import type { ItemSelectionModifiers } from "@/shared/interaction/item/useSelection";
import type { PlaylistSummary, PlaylistTrackSummary } from "@/features/playlist/types";
import PlaylistTrack from "@/features/playlist/tracks/PlaylistTrack.vue";
import TrackArtwork from "@/features/artwork/track/TrackArtwork.vue";
import SkipMenuItem from "@/features/playback/queue/SkipMenuItem.vue";
import UpdateMenuItem from "@/features/metadata/tracks/UpdateMenuItem.vue";
import RereadMenuItem from "@/features/tracks/presentation/RereadMenuItem.vue";
import AnalysisMenuItem from "@/features/metadata/replaygain/AnalysisMenuItem.vue";
import RemovalMenuItem from "@/features/metadata/replaygain/RemovalMenuItem.vue";
import EditMenuItem from "@/features/metadata/manual/EditMenuItem.vue";
import DownloadMenuItem from "@/features/lyrics/download/DownloadMenuItem.vue";
import ReleaseMenuItem from "@/features/metadata/releases/ReleaseMenuItem.vue";
import AppendMenuItem from "@/features/playlist/tracks/AppendMenuItem.vue";
import ImportMenuItem from "@/features/library/import/ImportMenuItem.vue";
import CreatePlaylistDialog from "@/features/playlist/creation/CreatePlaylistDialog.vue";
import { reportPlaylistChanged } from "@/features/playlist/events";
import { useTable } from "@/shared/interaction/table/useTable";
import TableHeader from "@/shared/interaction/table/TableHeader.vue";
import { trackColumns, trackColumnValue } from "@/features/tracks/table/columns";

const props = withDefaults(
  defineProps<{
    playlist: PlaylistSummary | null;
    coverTrackId?: number | null;
    isCoverPending?: boolean;
    tracks: readonly PlaylistTrackSummary[];
    currentRowKey: string | null;
    isLoadingPlaylists: boolean;
    playlistsError: string;
    hasPlaylists: boolean;
    isLoadingTracks: boolean;
    tracksError: string;
    isPlaylistActionPending: boolean;
    playlistActionError: string;
  }>(),
  {
    coverTrackId: null,
    isCoverPending: true,
  },
);

const createPlaylistDialog = ref<InstanceType<typeof CreatePlaylistDialog> | null>(null);
function createPlaylistWithTracks(ids: number[]) {
  createPlaylistDialog.value?.show(async () => ids);
}
const columns = computed(() => trackColumns());
const table = useTable({
  columns: () => columns.value,
  rows: () => props.tracks,
  value: trackColumnValue,
});
const sortedTracks = table.rows;
const tableStyle = table.style;
const naturalOrder = computed(
  () =>
    !table.sort.value ||
    (table.sort.value.key === "number" && table.sort.value.direction === "ascending"),
);
const trackNumbers = computed(
  () => new Map(props.tracks.map((track, index) => [track.playlistItemId, index + 1])),
);
const playlistTrackScope = computed(() =>
  JSON.stringify(["playlist", "tracks", props.playlist?.id ?? null]),
);
const playlistTrackFocus = useItemSelection(playlistTrackScope);
const visiblePlaylistItemIds = computed(() =>
  sortedTracks.value.map((track) => track.playlistItemId),
);
const visibleTrackKeys = computed(() => visiblePlaylistItemIds.value.map(String));
type PlaylistDragPreview = {
  beforeItemId: number | null;
  movingItemIds: number[];
  clientX: number;
  clientY: number;
};

const dragPreview = shallowRef<PlaylistDragPreview | null>(null);
const playlistHeadingElement = ref<InstanceType<typeof globalThis.HTMLHeadingElement> | null>(null);
const trackListElement = ref<InstanceType<typeof globalThis.HTMLOListElement> | null>(null);
const trackScrollContainerElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(
  null,
);
const contextMenuElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);

type PlaylistTrackContextMenuPayload = {
  itemKey: string;
  targetPlaylistItemIds: number[];
};

type PlaylistTrackContextMenuRequest = {
  playlistItemId: number;
  x: number;
  y: number;
  trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
};

type PendingRemovalFocus = {
  playlistId: number;
  targetPlaylistItemIds: number[];
  firstRemovedIndex: number;
  trigger: InstanceType<typeof globalThis.HTMLElement>;
};

const pendingRemovalFocus = shallowRef<PendingRemovalFocus | null>(null);
const {
  request: contextMenu,
  position: menuPosition,
  open: openContextMenu,
  close: closeContextMenu,
} = useContextMenu<PlaylistTrackContextMenuPayload>({
  menuElement: contextMenuElement,
  fallbackFocusElement: playlistHeadingElement,
});

watch(visibleTrackKeys, (itemKeys) => playlistTrackFocus.syncVisibleItems(itemKeys), {
  immediate: true,
});

const emit = defineEmits<{
  playTrack: [playlistItemId: number, orderedPlaylistItemIds: number[]];
  playPlaylist: [orderedPlaylistItemIds: number[]];
  addPlaylistItemsToNext: [playlistItemIds: number[]];
  addPlaylistItemsToQueueEnd: [playlistItemIds: number[]];
  removePlaylistItems: [playlistItemIds: number[]];
  reorderPlaylistItems: [orderedPlaylistItemIds: number[]];
}>();

const keyboard = createItemKeyboard({
  getItemKeys: () =>
    props.isLoadingTracks || props.isPlaylistActionPending || dragPreview.value
      ? []
      : visibleTrackKeys.value,
  getSelectedItemKeys: () => playlistTrackFocus.getSelectedItemKeys(visibleTrackKeys.value),
  itemSelector: "button[data-playlist-track-select]",
  onFocus: (key) => {
    if (!playlistTrackFocus.isFocused(key)) playlistTrackFocus.focusItem(key);
  },
  onMove: (key, event) => {
    playlistTrackFocus.selectItem(key, visibleTrackKeys.value, event);
  },
  onSelectAll: (keys) => playlistTrackFocus.selectAll(keys),
  onActivate: (key) => {
    const track = props.tracks.find((entry) => String(entry.playlistItemId) === key);
    if (track) emit("playTrack", track.playlistItemId, visiblePlaylistItemIds.value);
  },
});

useContextCommands(trackListElement, () => {
  if (props.isLoadingTracks || props.isPlaylistActionPending || dragPreview.value) return {};
  const selected = playlistTrackFocus.getSelectedItemKeys(visibleTrackKeys.value);
  const ids = (
    selected.length
      ? selected
      : visibleTrackKeys.value.filter((key) => playlistTrackFocus.isFocused(key))
  ).map(Number);
  return ids.length ? { addToQueue: () => emit("addPlaylistItemsToQueueEnd", ids) } : {};
});

function getTrackRowKey(playlistItemId: number) {
  return `playlist-item:${playlistItemId}`;
}

function selectTrack(playlistItemId: number, modifiers: ItemSelectionModifiers) {
  playlistTrackFocus.selectItem(String(playlistItemId), visibleTrackKeys.value, modifiers);
}

function getContextTargetPlaylistItemIds(itemKeys: readonly string[]) {
  const targetKeys = new Set(itemKeys);
  return sortedTracks.value.flatMap((track) =>
    targetKeys.has(String(track.playlistItemId)) ? [track.playlistItemId] : [],
  );
}

const playlistDragReorder = createPlaylistDragReorder({
  canStart: () =>
    props.playlist !== null &&
    naturalOrder.value &&
    !props.isLoadingTracks &&
    !props.isPlaylistActionPending,
  getItemIds: () => props.tracks.map((track) => track.playlistItemId),
  getListElement: () => trackListElement.value,
  getScrollContainer: () => trackScrollContainerElement.value,
  onDragStart: ({ playlistItemId, itemIds, shouldSelectDraggedItem }) => {
    closeContextMenu(false);
    if (shouldSelectDraggedItem) {
      playlistTrackFocus.selectItem(String(playlistItemId), itemIds.map(String), {
        ctrlKey: false,
        shiftKey: false,
      });
    }
  },
  onPreview: (preview) => {
    dragPreview.value = preview;
  },
  onDrop: (orderedPlaylistItemIds) => {
    dragPreview.value = null;
    emit("reorderPlaylistItems", orderedPlaylistItemIds);
  },
  onCancel: () => {
    dragPreview.value = null;
  },
});

function beginTrackReorder(
  playlistItemId: number,
  event: InstanceType<typeof globalThis.PointerEvent>,
) {
  const itemKey = String(playlistItemId);
  const selectedItemKeys = playlistTrackFocus.getSelectedItemKeys(visibleTrackKeys.value);
  const wasSelected = selectedItemKeys.includes(itemKey);
  const movingItemKeys = wasSelected ? selectedItemKeys : [itemKey];
  const movingItemIds = getContextTargetPlaylistItemIds(movingItemKeys);
  playlistDragReorder.begin(event, playlistItemId, movingItemIds, !wasSelected);
}

function getTrackDropPosition(playlistItemId: number, trackIndex: number) {
  const preview = dragPreview.value;
  if (!preview) return null;
  if (preview.beforeItemId === playlistItemId) return "before";
  if (preview.beforeItemId === null && trackIndex === props.tracks.length - 1) return "after";
  return null;
}

watch(
  [
    visibleTrackKeys,
    () => props.tracks,
    () => props.isLoadingTracks,
    () => props.isPlaylistActionPending,
  ],
  () => playlistDragReorder.cancel(),
  { flush: "sync" },
);

onUnmounted(() => playlistDragReorder.dispose());

function openTrackContextMenu(request: PlaylistTrackContextMenuRequest) {
  const itemKey = String(request.playlistItemId);
  const targetKeys = playlistTrackFocus.contextMenuTargets(itemKey, visibleTrackKeys.value);
  const targetPlaylistItemIds = getContextTargetPlaylistItemIds(targetKeys);
  if (targetPlaylistItemIds.length === 0) return;

  openContextMenu({
    x: request.x,
    y: request.y,
    trigger: request.trigger,
    payload: { itemKey, targetPlaylistItemIds },
  });
}

const contextTargetTrackIds = computed(() => {
  const itemIds = new Set(contextMenu.value?.payload.targetPlaylistItemIds ?? []);
  return props.tracks
    .filter((track) => itemIds.has(track.playlistItemId))
    .map((track) => track.trackId);
});

function getActionTargetPlaylistItemIds() {
  if (props.isPlaylistActionPending) return null;
  const targetPlaylistItemIds = contextMenu.value?.payload.targetPlaylistItemIds;
  return targetPlaylistItemIds?.length ? [...targetPlaylistItemIds] : null;
}

function addToNext() {
  const targetPlaylistItemIds = getActionTargetPlaylistItemIds();
  if (!targetPlaylistItemIds) return;

  closeContextMenu(true);
  emit("addPlaylistItemsToNext", targetPlaylistItemIds);
}

function addToQueueEnd() {
  const targetPlaylistItemIds = getActionTargetPlaylistItemIds();
  if (!targetPlaylistItemIds) return;

  closeContextMenu(true);
  emit("addPlaylistItemsToQueueEnd", targetPlaylistItemIds);
}

function removeFromPlaylist() {
  const targetPlaylistItemIds = getActionTargetPlaylistItemIds();
  const playlistId = props.playlist?.id;
  if (!targetPlaylistItemIds || playlistId === undefined) return;

  const targetIds = new Set(targetPlaylistItemIds);
  const firstRemovedIndex = sortedTracks.value.findIndex((track) =>
    targetIds.has(track.playlistItemId),
  );
  if (firstRemovedIndex < 0) {
    closeContextMenu(true);
    return;
  }

  const request = contextMenu.value;
  if (!request) return;
  pendingRemovalFocus.value = {
    playlistId,
    targetPlaylistItemIds,
    firstRemovedIndex,
    trigger: request.trigger,
  };
  closeContextMenu(false);
  emit("removePlaylistItems", targetPlaylistItemIds);
}

function focusPlaylistHeading() {
  playlistHeadingElement.value?.focus({ preventScroll: true });
}

function focusTrackAt(index: number) {
  const trackIndex = Math.min(index, sortedTracks.value.length - 1);
  const track = sortedTracks.value[trackIndex];
  const row = trackListElement.value?.children.item(trackIndex);
  const button = row?.querySelector<InstanceType<typeof globalThis.HTMLButtonElement>>(
    "button[data-playlist-track-select]",
  );
  if (!track || !button) {
    focusPlaylistHeading();
    return;
  }

  playlistTrackFocus.focusItem(String(track.playlistItemId));
  button.focus({ preventScroll: true });
}

watch(
  visibleTrackKeys,
  (itemKeys, previousItemKeys) => {
    const pending = pendingRemovalFocus.value;
    if (!pending || pending.playlistId !== props.playlist?.id || props.isLoadingTracks) {
      return;
    }

    const previousKeys = new Set(previousItemKeys);
    const currentKeys = new Set(itemKeys);
    const targetsRemoved = pending.targetPlaylistItemIds.every((playlistItemId) => {
      const itemKey = String(playlistItemId);
      return previousKeys.has(itemKey) && !currentKeys.has(itemKey);
    });
    if (!targetsRemoved) return;

    pendingRemovalFocus.value = null;
    focusTrackAt(pending.firstRemovedIndex);
  },
  { flush: "post" },
);

watch(
  playlistTrackScope,
  () => {
    playlistDragReorder.cancel();
    pendingRemovalFocus.value = null;
    closeContextMenu(false);
  },
  { flush: "sync" },
);

watch(
  () => {
    const request = contextMenu.value;
    return (
      request === null ||
      request.payload.targetPlaylistItemIds.every((playlistItemId) =>
        props.tracks.some((track) => track.playlistItemId === playlistItemId),
      )
    );
  },
  (areTargetsVisible) => {
    if (!areTargetsVisible) closeContextMenu(true);
  },
);

watch(
  [() => props.isPlaylistActionPending, () => props.playlistActionError],
  ([isPending, error]) => {
    const pending = pendingRemovalFocus.value;
    if (!pending || isPending || !error) return;

    pendingRemovalFocus.value = null;
    if (pending.trigger.isConnected) pending.trigger.focus({ preventScroll: true });
    else focusPlaylistHeading();
  },
);
</script>

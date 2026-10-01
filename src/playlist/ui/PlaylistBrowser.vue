<template>
  <section
    aria-label="播放列表浏览"
    class="sidebar-scrollbars bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-white"
  >
    <template v-if="props.playlist">
      <header
        class="to-spotify-base shrink-0 bg-linear-to-b from-indigo-950 via-[#211a30] px-5 py-6 sm:px-8 sm:py-8"
      >
        <div class="flex items-end gap-5">
          <TrackArtwork
            :track-id="props.coverTrackId"
            :pending="props.isCoverPending"
            alt=""
            class="size-28 shrink-0 rounded-md sm:size-36"
          >
            <div
              aria-hidden="true"
              class="grid h-full w-full place-items-center rounded-md bg-linear-to-br from-violet-800 via-indigo-950 to-slate-950"
            >
              <DiscAlbum class="size-12 text-white/75 sm:size-16" stroke-width="1.25" />
            </div>
          </TrackArtwork>
          <div class="min-w-0 flex-1 pb-1">
            <p class="mb-2 text-xs font-semibold tracking-wide text-white/75 uppercase">播放列表</p>
            <h1
              id="playlist-browser-heading"
              ref="playlistHeadingElement"
              class="truncate text-2xl font-bold tracking-tight sm:text-4xl"
              tabindex="-1"
            >
              {{ props.playlist.name }}
            </h1>
          </div>
          <button
            aria-label="播放歌单"
            class="focus-visible:outline-spotify-green bg-spotify-green grid size-11 shrink-0 place-items-center rounded-full text-black transition-transform focus-visible:outline-2"
            :class="
              props.isLoadingTracks || props.tracks.length === 0
                ? 'cursor-not-allowed opacity-50'
                : 'hover:scale-105 active:scale-95'
            "
            :disabled="props.isLoadingTracks || props.tracks.length === 0"
            title="播放歌单"
            type="button"
            @click="emit('playPlaylist')"
          >
            <Play aria-hidden="true" class="ml-0.5 size-5 fill-current" />
          </button>
        </div>
      </header>

      <div
        ref="trackScrollContainerElement"
        class="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-8"
      >
        <div
          class="bg-spotify-base/95 text-spotify-muted sticky top-0 z-10 grid grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-3 border-b border-white/10 py-2 text-xs backdrop-blur-sm sm:grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1fr)_3rem]"
        >
          <span class="text-right">#</span>
          <span>歌曲</span>
          <span class="hidden sm:block">专辑</span>
          <span class="text-right">时长</span>
        </div>

        <p v-if="props.isLoadingTracks" class="text-spotify-muted py-4 text-sm" role="status">
          正在读取歌单曲目…
        </p>
        <p v-else-if="props.playlistsError" class="py-4 text-sm text-red-300" role="alert">
          {{ props.playlistsError }}
        </p>
        <p v-else-if="props.tracksError" class="py-4 text-sm text-red-300" role="alert">
          {{ props.tracksError }}
        </p>
        <p v-else-if="props.tracks.length === 0" class="text-spotify-muted py-4 text-sm">
          此歌单暂无歌曲。
        </p>
        <ol v-else ref="trackListElement">
          <PlaylistTrack
            v-for="(track, index) in props.tracks"
            :key="track.playlistItemId"
            :track="track"
            :track-number="index + 1"
            :is-focused="playlistTrackFocus.isFocused(String(track.playlistItemId))"
            :is-selected="playlistTrackFocus.isSelected(String(track.playlistItemId))"
            :is-current-track="props.currentRowKey === getTrackRowKey(track.playlistItemId)"
            :is-context-menu-open="contextMenu?.payload.itemKey === String(track.playlistItemId)"
            :is-drag-disabled="props.isLoadingTracks || props.isPlaylistActionPending"
            :is-dragging="dragPreview?.movingItemIds.includes(track.playlistItemId) ?? false"
            :drop-position="getTrackDropPosition(track.playlistItemId, index)"
            @select="selectTrack(track.playlistItemId, $event)"
            @play="emit('playTrack', track.playlistItemId)"
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
        class="bg-spotify-interactive fixed z-100 w-56 rounded-md p-1 shadow-xl ring-1 ring-white/10"
        :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
        role="menu"
        aria-label="歌单条目操作"
        @pointerdown.stop
      >
        <button
          ref="firstMenuItemElement"
          class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
          role="menuitem"
          :disabled="props.isPlaylistActionPending"
          type="button"
          @click.stop="addToNext"
        >
          添加为下一首
        </button>
        <button
          class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
          role="menuitem"
          :disabled="props.isPlaylistActionPending"
          type="button"
          @click.stop="addToQueueEnd"
        >
          添加到队尾
        </button>
        <div class="my-1 border-t border-white/10" role="separator"></div>
        <button
          class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-red-200 hover:bg-white/10 focus-visible:outline-2"
          role="menuitem"
          :disabled="props.isPlaylistActionPending"
          type="button"
          @click.stop="removeFromPlaylist"
        >
          从当前歌单移除
        </button>
      </div>
      <div
        v-if="dragPreview"
        data-playlist-drag-preview
        aria-hidden="true"
        class="bg-spotify-interactive pointer-events-none fixed z-100 grid size-9 place-items-center rounded-md text-white shadow-xl ring-1 ring-white/20"
        :style="{ left: `${dragPreview.clientX + 10}px`, top: `${dragPreview.clientY + 10}px` }"
      >
        <Files aria-hidden="true" class="text-spotify-green size-5" />
        <span
          class="bg-spotify-green absolute -top-1 -right-1 grid min-h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-bold text-black"
        >
          {{ dragPreview.movingItemIds.length }}
        </span>
      </div>
    </template>

    <div v-else class="grid min-h-0 flex-1 place-items-center px-5 text-center">
      <p v-if="props.isLoadingPlaylists" class="text-spotify-muted text-sm" role="status">
        正在读取歌单…
      </p>
      <p v-else-if="props.playlistsError" class="text-sm text-red-300" role="alert">
        {{ props.playlistsError }}
      </p>
      <p v-else-if="!props.hasPlaylists" class="text-spotify-muted text-sm">还没有歌单。</p>
      <p v-else class="text-spotify-muted text-sm">请选择一个歌单。</p>
    </div>

    <div
      v-if="props.playlistActionError"
      class="bg-spotify-interactive fixed right-4 bottom-24 z-100 flex max-w-[min(28rem,calc(100vw-2rem))] items-start gap-3 rounded-xl px-4 py-3 text-sm text-red-100 shadow-xl ring-1 ring-white/10"
      role="alert"
    >
      <p class="min-w-0 flex-1 whitespace-pre-wrap">{{ props.playlistActionError }}</p>
      <button
        aria-label="关闭错误通知"
        class="focus-visible:outline-spotify-green -mr-1 -ml-1 rounded p-1 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2"
        type="button"
        @click="emit('dismissPlaylistActionError')"
      >
        <X aria-hidden="true" class="size-4" />
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { DiscAlbum, Files, Play, X } from "@lucide/vue";
import { useContextMenu } from "@/interaction/contextMenu";
import { useItemFocusList } from "@/interaction/itemFocus";
import { createPlaylistDragReorder } from "@/playlist/dragReorder";
import type { ItemSelectionModifiers } from "@/interaction/itemFocus";
import type { Playlist, PlaylistTrackData } from "@/types/playlist";
import PlaylistTrack from "@/playlist/ui/PlaylistTrack.vue";
import TrackArtwork from "@/artwork/ui/TrackArtwork.vue";

const props = withDefaults(
  defineProps<{
    playlist: Playlist | null;
    coverTrackId?: number | null;
    isCoverPending?: boolean;
    tracks: PlaylistTrackData[];
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

const playlistTrackScope = computed(() =>
  JSON.stringify(["playlist", "tracks", props.playlist?.id ?? null]),
);
const playlistTrackFocus = useItemFocusList(playlistTrackScope);
const visibleTrackKeys = computed(() => props.tracks.map((track) => String(track.playlistItemId)));
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
const firstMenuItemElement = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);

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
  firstMenuItemElement,
  fallbackFocusElement: playlistHeadingElement,
});

watch(visibleTrackKeys, (itemKeys) => playlistTrackFocus.syncVisibleItems(itemKeys), {
  immediate: true,
});

const emit = defineEmits<{
  playTrack: [playlistItemId: number];
  playPlaylist: [];
  addPlaylistItemsToNext: [playlistItemIds: number[]];
  addPlaylistItemsToQueueEnd: [playlistItemIds: number[]];
  removePlaylistItems: [playlistItemIds: number[]];
  reorderPlaylistItems: [orderedPlaylistItemIds: number[]];
  dismissPlaylistActionError: [];
}>();

function getTrackRowKey(playlistItemId: number) {
  return `playlist-item:${playlistItemId}`;
}

function selectTrack(playlistItemId: number, modifiers: ItemSelectionModifiers) {
  playlistTrackFocus.selectItem(String(playlistItemId), visibleTrackKeys.value, modifiers);
}

function getContextTargetPlaylistItemIds(itemKeys: readonly string[]) {
  const targetKeys = new Set(itemKeys);
  return props.tracks.flatMap((track) =>
    targetKeys.has(String(track.playlistItemId)) ? [track.playlistItemId] : [],
  );
}

const playlistDragReorder = createPlaylistDragReorder({
  canStart: () =>
    props.playlist !== null && !props.isLoadingTracks && !props.isPlaylistActionPending,
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
  const firstRemovedIndex = props.tracks.findIndex((track) => targetIds.has(track.playlistItemId));
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
  const trackIndex = Math.min(index, props.tracks.length - 1);
  const track = props.tracks[trackIndex];
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

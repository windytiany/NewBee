<template>
  <section
    aria-label="播放列表浏览"
    class="bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col text-white"
  >
    <header class="flex shrink-0 items-center justify-between gap-2 px-2 py-1">
      <h2 class="text-sm font-medium text-white/90">播放列表浏览</h2>
      <button
        ref="createPlaylistButtonElement"
        class="focus-visible:outline-spotify-green shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2"
        type="button"
        @click="emit('create')"
      >
        新建歌单
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <p
        v-if="!props.isLoading && !props.error && props.playlists.length === 0"
        class="text-spotify-muted px-2 py-3 text-sm"
      >
        还没有歌单。
      </p>
      <ul v-if="props.playlists.length > 0" ref="playlistListElement" class="space-y-0.5">
        <PlaylistListItem
          v-for="playlist in props.playlists"
          :key="playlist.id"
          :playlist-id="playlist.id"
          :name="playlist.name"
          :cover-track-id="playlist.coverTrackId"
          :is-focused="playlistFocus.isFocused(String(playlist.id))"
          :is-selected="props.selectedPlaylistId === playlist.id"
          :is-context-menu-open="contextMenu?.payload === playlist.id"
          @select="selectPlaylist(playlist)"
          @context-menu="openPlaylistContextMenu"
        />
      </ul>
    </div>

    <div
      v-if="contextMenu"
      id="playlist-list-context-menu"
      ref="contextMenuElement"
      data-item-interaction
      class="bg-spotify-interactive fixed z-100 w-48 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      role="menu"
      aria-label="歌单操作"
      @pointerdown.stop
    >
      <button
        ref="firstMenuItemElement"
        class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
        role="menuitem"
        :disabled="isContextMenuTargetPending"
        type="button"
        @click.stop="requestRename"
      >
        重命名
      </button>
      <div class="my-1 border-t border-white/10" role="separator"></div>
      <button
        class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-red-200 hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
        role="menuitem"
        :disabled="isContextMenuTargetPending"
        type="button"
        @click.stop="requestDelete"
      >
        删除歌单
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useContextMenu } from "@/interaction/contextMenu";
import { useItemFocusList } from "@/interaction/itemFocus";
import type { PlaylistSummary } from "@/playlist/model";
import PlaylistListItem from "@/playlist/ui/PlaylistListItem.vue";

const props = defineProps<{
  playlists: readonly PlaylistSummary[];
  selectedPlaylistId: number | null;
  isLoading: boolean;
  error: string;
  pendingPlaylistIds: readonly number[];
}>();

const emit = defineEmits<{
  select: [playlist: PlaylistSummary];
  create: [];
  rename: [playlistId: number];
  delete: [playlistId: number];
}>();

const playlistFocus = useItemFocusList("playlist:navigation");
const playlistListElement = ref<InstanceType<typeof globalThis.HTMLUListElement> | null>(null);
const createPlaylistButtonElement = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(
  null,
);
const contextMenuElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const firstMenuItemElement = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const playlistItemKeys = computed(() => props.playlists.map((playlist) => String(playlist.id)));
type PlaylistContextMenuRequest = {
  playlistId: number;
  x: number;
  y: number;
  trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
};

const {
  request: contextMenu,
  position: menuPosition,
  open: openContextMenu,
  close: closeContextMenu,
} = useContextMenu<number>({
  menuElement: contextMenuElement,
  firstMenuItemElement,
  fallbackFocusElement: createPlaylistButtonElement,
});
const contextMenuTargetExists = computed(() => {
  const playlistId = contextMenu.value?.payload;
  return playlistId === undefined || props.playlists.some((playlist) => playlist.id === playlistId);
});
const isContextMenuTargetPending = computed(() => {
  const playlistId = contextMenu.value?.payload;
  return playlistId !== undefined && props.pendingPlaylistIds.includes(playlistId);
});

watch(playlistItemKeys, (itemKeys) => playlistFocus.syncVisibleItems(itemKeys), {
  immediate: true,
});
watch(contextMenuTargetExists, (targetExists) => {
  if (!targetExists) closeContextMenu();
});

function selectPlaylist(playlist: PlaylistSummary) {
  playlistFocus.focusItem(String(playlist.id));
  emit("select", playlist);
}

function openPlaylistContextMenu(request: PlaylistContextMenuRequest) {
  const playlist = props.playlists.find((entry) => entry.id === request.playlistId);
  if (!playlist) return;

  playlistFocus.focusItem(String(playlist.id));
  openContextMenu({
    x: request.x,
    y: request.y,
    trigger: request.trigger,
    payload: playlist.id,
  });
}

function requestPlaylistAction(action: "rename" | "delete") {
  const playlistId = contextMenu.value?.payload;
  closeContextMenu();
  if (playlistId === undefined) return;

  const playlist = props.playlists.find((entry) => entry.id === playlistId);
  if (!playlist || props.pendingPlaylistIds.includes(playlist.id)) return;

  if (action === "rename") emit("rename", playlist.id);
  else emit("delete", playlist.id);
}

function requestRename() {
  requestPlaylistAction("rename");
}

function requestDelete() {
  requestPlaylistAction("delete");
}

function focusPlaylistButton(playlistId: number) {
  const button = playlistListElement.value?.querySelector<
    InstanceType<typeof globalThis.HTMLButtonElement>
  >(`[data-playlist-id="${playlistId}"]`);
  if (!button) return;

  playlistFocus.focusItem(String(playlistId));
  button.focus({ preventScroll: true });
}

async function focusPlaylist(playlistId: number) {
  await nextTick();
  focusPlaylistButton(playlistId);
}

async function focusAfterDeletion(originalIndex: number) {
  await nextTick();
  const playlistIndex = Math.min(Math.max(originalIndex, 0), props.playlists.length - 1);
  const playlist = props.playlists[playlistIndex];
  if (!playlist) {
    createPlaylistButtonElement.value?.focus({ preventScroll: true });
    return;
  }

  focusPlaylistButton(playlist.id);
}

defineExpose({ focusPlaylist, focusAfterDeletion });
</script>

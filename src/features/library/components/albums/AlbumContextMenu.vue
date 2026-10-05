<template>
  <div
    v-if="contextMenu"
    id="album-context-menu"
    ref="menuElement"
    data-item-interaction
    class="bg-app-interactive fixed z-100 w-64 rounded-md p-1 shadow-xl ring-1 ring-white/10"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    role="menu"
    aria-label="专辑操作"
    @pointerdown.stop
    @pointerleave="isPlaylistMenuOpen = false"
  >
    <button
      ref="firstMenuItemElement"
      class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
      role="menuitem"
      :disabled="pending"
      type="button"
      @click.stop="runAction('next')"
    >
      添加为下一首
    </button>
    <button
      class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
      role="menuitem"
      :disabled="pending"
      type="button"
      @click.stop="runAction('end')"
    >
      添加到队尾
    </button>
    <button
      ref="playlistTriggerElement"
      class="focus-visible:outline-app-accent flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm focus-visible:outline-2 disabled:opacity-50"
      :class="isPlaylistMenuOpen ? 'bg-app-accent text-black' : 'hover:bg-white/10'"
      role="menuitem"
      aria-haspopup="menu"
      :aria-expanded="isPlaylistMenuOpen"
      :aria-controls="isPlaylistMenuOpen ? 'album-playlist-menu' : undefined"
      :disabled="pending"
      type="button"
      @mouseenter="openPlaylistMenu()"
      @click.stop="openPlaylistMenu(true)"
    >
      添加到播放列表<ChevronRight aria-hidden="true" class="size-4" />
    </button>
    <div
      v-if="isPlaylistMenuOpen"
      id="album-playlist-menu"
      ref="playlistMenuElement"
      class="bg-app-interactive fixed z-101 max-h-72 w-56 overflow-y-auto rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${playlistPosition.x}px`, top: `${playlistPosition.y}px` }"
      role="menu"
      aria-label="选择目标歌单"
    >
      <p
        v-if="!playlistsLoading && !playlistsError && playlists.length === 0"
        class="text-app-muted px-2 py-2 text-sm"
      >
        无歌单
      </p>
      <button
        v-for="playlist in playlists"
        v-else-if="!playlistsLoading && !playlistsError"
        :key="playlist.id"
        ref="playlistItemElements"
        class="focus-visible:outline-app-accent w-full truncate rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        role="menuitem"
        :disabled="pending"
        type="button"
        @click.stop="runAction('playlist', playlist.id)"
      >
        {{ playlist.name }}
      </button>
    </div>
    <EditMenuItem :album="contextMenu.payload" :disabled="pending" @close="close(true)" />
    <DownloadMenuItem :album="contextMenu.payload" :disabled="pending" @close="close(true)" />
    <ReleaseMenuItem :album="contextMenu.payload" :disabled="pending" @close="close(true)" />
    <div class="my-1 border-t border-white/10" role="separator"></div>
    <button
      class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-red-200 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
      role="menuitem"
      :disabled="pending"
      type="button"
      @click.stop="runAction('delete')"
    >
      从库中删除
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { ChevronRight } from "@lucide/vue";
import { useContextMenu } from "@/shared/interaction/useContextMenu";
import EditMenuItem from "@/features/tags/manual/components/EditMenuItem.vue";
import DownloadMenuItem from "@/features/lyrics/components/DownloadMenuItem.vue";
import ReleaseMenuItem from "@/features/tags/releases/components/ReleaseMenuItem.vue";
import type { LibraryAlbumSelection } from "@/features/library/types";
import type { PlaylistSummary } from "@/features/playlist/types";

const props = defineProps<{
  scope: string;
  albumKeys: string[];
  pending: boolean;
  playlists: readonly PlaylistSummary[];
  playlistsLoading: boolean;
  playlistsError: string;
}>();
const emit = defineEmits<{
  refreshPlaylists: [];
  addToNext: [album: LibraryAlbumSelection];
  addToQueueEnd: [album: LibraryAlbumSelection];
  addToPlaylist: [album: LibraryAlbumSelection, playlistId: number];
  deleteAlbum: [album: LibraryAlbumSelection];
}>();
type MenuElement = InstanceType<typeof globalThis.HTMLElement>;
const menuElement = ref<MenuElement | null>(null);
const firstMenuItemElement = ref<MenuElement | null>(null);
const fallbackFocusElement = ref<MenuElement | null>(null);
const playlistTriggerElement = ref<MenuElement | null>(null);
const playlistMenuElement = ref<MenuElement | null>(null);
const playlistItemElements = ref<MenuElement[]>([]);
const {
  request: contextMenu,
  position,
  open: openContextMenu,
  close,
} = useContextMenu<LibraryAlbumSelection>({
  menuElement,
  firstMenuItemElement,
  fallbackFocusElement,
});
const isPlaylistMenuOpen = ref(false);
const playlistPosition = ref({ x: 0, y: 0 });

function open(request: {
  album: LibraryAlbumSelection;
  x: number;
  y: number;
  trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
}) {
  isPlaylistMenuOpen.value = false;
  openContextMenu({ ...request, payload: request.album });
  emit("refreshPlaylists");
}

function positionPlaylistMenu() {
  const menuBounds = menuElement.value?.getBoundingClientRect();
  const triggerBounds = playlistTriggerElement.value?.getBoundingClientRect();
  const bounds = playlistMenuElement.value?.getBoundingClientRect();
  if (!menuBounds || !triggerBounds || !bounds) return;
  const x =
    menuBounds.right + bounds.width <= globalThis.innerWidth
      ? menuBounds.right
      : menuBounds.left - bounds.width;
  playlistPosition.value = {
    x: Math.max(0, Math.min(x, globalThis.innerWidth - bounds.width)),
    y: Math.max(0, Math.min(triggerBounds.top, globalThis.innerHeight - bounds.height)),
  };
}

function openPlaylistMenu(focusFirst = false) {
  if (props.pending) return;
  const wasOpen = isPlaylistMenuOpen.value;
  isPlaylistMenuOpen.value = true;
  if (!wasOpen) emit("refreshPlaylists");
  void nextTick(() => {
    positionPlaylistMenu();
    if (focusFirst) playlistItemElements.value[0]?.focus();
  });
}

function runAction(action: "next" | "end" | "playlist" | "delete", playlistId?: number) {
  const album = contextMenu.value?.payload;
  if (!album || props.pending) return;
  close(true);
  if (action === "next") emit("addToNext", album);
  else if (action === "end") emit("addToQueueEnd", album);
  else if (action === "delete") emit("deleteAlbum", album);
  else if (playlistId !== undefined) emit("addToPlaylist", album, playlistId);
}

watch(contextMenu, (request) => {
  if (!request) isPlaylistMenuOpen.value = false;
});
watch(
  () => props.scope,
  () => close(),
);
watch(
  () => props.albumKeys,
  (keys) => {
    const album = contextMenu.value?.payload;
    if (album && !keys.includes(JSON.stringify([album.albumArtist, album.album]))) close(true);
  },
);
watch(
  () => [props.playlists.length, props.playlistsLoading, props.playlistsError],
  () => {
    if (isPlaylistMenuOpen.value) void nextTick(positionPlaylistMenu);
  },
);

defineExpose({ open, contextMenu });
</script>

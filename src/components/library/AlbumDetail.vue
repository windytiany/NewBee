<template>
  <article
    class="bg-spotify-interactive rounded-lg px-5 py-5 text-white shadow-xl ring-1 ring-white/10 sm:px-7"
  >
    <header class="mb-5 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-3">
          <h2
            ref="albumHeadingElement"
            class="min-w-0 flex-1 truncate text-xl font-bold sm:text-2xl"
            tabindex="-1"
          >
            {{ props.album.album ?? "未知专辑" }}
          </h2>
          <button
            aria-label="播放专辑"
            class="focus-visible:outline-spotify-green bg-spotify-green grid size-9 shrink-0 place-items-center rounded-full text-black focus-visible:outline-2"
            :class="
              props.tracksLoading || props.tracks.length === 0
                ? 'cursor-not-allowed opacity-50'
                : 'hover:scale-105 active:scale-95'
            "
            :disabled="props.tracksLoading || props.tracks.length === 0"
            title="播放专辑"
            type="button"
            @click="emit('playAlbum')"
          >
            <Play aria-hidden="true" class="ml-0.5 size-4 fill-current" />
          </button>
        </div>
        <p class="text-spotify-muted mt-1 truncate text-sm">{{ props.album.year ?? "年份未知" }}</p>
      </div>
      <button
        aria-label="收起专辑曲目"
        class="focus-visible:outline-spotify-green text-spotify-muted grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2"
        type="button"
        @click="emit('close')"
      >
        <X aria-hidden="true" class="size-4" />
      </button>
    </header>

    <h3 class="sr-only">曲目</h3>
    <p v-if="props.tracksLoading" class="text-spotify-muted py-3 text-sm" role="status">
      正在读取曲目…
    </p>
    <p v-else-if="props.tracksError" class="py-3 text-sm text-red-300" role="alert">
      {{ props.tracksError }}
    </p>
    <ol
      v-else-if="props.tracks.length > 0"
      class="grid gap-x-8 sm:grid-flow-col sm:grid-cols-2"
      :style="{ gridTemplateRows: `repeat(${Math.ceil(props.tracks.length / 2)}, auto)` }"
    >
      <AlbumTrack
        v-for="(track, index) in props.tracks"
        :key="track.id"
        :track="track"
        :index="index"
        :is-focused="focusedItem === getTrackFocusKey(track.id)"
        :is-selected="track.id === props.selectedTrackId"
        :is-current-track="track.id === props.currentTrackId"
        :is-context-menu-open="contextMenu?.trackId === track.id"
        @select="selectTrack(track.id)"
        @play="emit('playTrack', track.id)"
        @context-menu="openTrackContextMenu"
      />
    </ol>
    <p v-else class="text-spotify-muted py-3 text-sm">此专辑暂无曲目。</p>

    <div
      v-if="contextMenu"
      id="album-track-context-menu"
      ref="contextMenuElement"
      class="bg-spotify-interactive fixed z-100 w-64 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      role="menu"
      aria-label="专辑曲目操作"
      @pointerdown.stop
      @pointerleave="closePlaylistMenuOnPointerLeave"
    >
      <button
        ref="firstMenuItemElement"
        class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
        role="menuitem"
        :disabled="props.trackActionPending"
        type="button"
        @click.stop="addToNext"
      >
        添加为下一首
      </button>
      <button
        class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
        role="menuitem"
        :disabled="props.trackActionPending"
        type="button"
        @click.stop="addToQueueEnd"
      >
        添加到队尾
      </button>
      <button
        ref="playlistMenuTriggerElement"
        class="focus-visible:outline-spotify-green flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm focus-visible:outline-2"
        :class="isPlaylistMenuOpen ? 'bg-spotify-green text-black' : 'text-white hover:bg-white/10'"
        role="menuitem"
        aria-haspopup="menu"
        :aria-expanded="isPlaylistMenuOpen && !props.playlistsLoading"
        :aria-controls="
          isPlaylistMenuOpen && !props.playlistsLoading ? 'album-track-playlist-menu' : undefined
        "
        :disabled="props.trackActionPending"
        type="button"
        @mouseenter="openPlaylistMenu()"
        @click.stop="openPlaylistMenu(true)"
      >
        添加到播放列表
        <ChevronRight aria-hidden="true" class="size-4" />
      </button>
      <div
        v-if="isPlaylistMenuOpen && !props.playlistsLoading"
        id="album-track-playlist-menu"
        ref="playlistMenuElement"
        class="bg-spotify-interactive fixed z-101 max-h-72 w-56 overflow-y-auto rounded-md p-1 shadow-xl ring-1 ring-white/10"
        :style="{ left: `${playlistMenuPosition.x}px`, top: `${playlistMenuPosition.y}px` }"
        role="menu"
        aria-label="选择目标歌单"
      >
        <p v-if="props.playlistsError" class="px-2 py-2 text-sm text-red-300" role="alert">
          读取歌单失败：{{ props.playlistsError }}
        </p>
        <p v-else-if="props.playlists.length === 0" class="text-spotify-muted px-2 py-2 text-sm">
          暂无可用歌单。
        </p>
        <button
          v-for="playlist in props.playlists"
          v-else
          :key="playlist.id"
          ref="playlistMenuItemElements"
          class="focus-visible:outline-spotify-green w-full truncate rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
          role="menuitem"
          :disabled="props.trackActionPending"
          type="button"
          @click.stop="addTrackToPlaylist(playlist.id)"
        >
          {{ playlist.name }}
        </button>
      </div>
      <div class="my-1 border-t border-white/10" role="separator"></div>
      <button
        class="focus-visible:outline-spotify-green w-full rounded px-2 py-2 text-left text-sm text-red-200 hover:bg-white/10 focus-visible:outline-2"
        role="menuitem"
        :disabled="props.trackActionPending"
        type="button"
        @click.stop="requestTrackDeletion"
      >
        从库中删除
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { ChevronRight, Play, X } from "@lucide/vue";
import { useClickFocus } from "@/composables/useClickFocus";
import type { AlbumSummary } from "@/types/album";
import type { Playlist } from "@/types/playlist";
import type { TrackSummary } from "@/types/track";
import AlbumTrack from "@/components/library/AlbumTrack.vue";

type TrackContextMenuRequest = {
  trackId: number;
  x: number;
  y: number;
  trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
};

const props = defineProps<{
  album: AlbumSummary;
  tracks: TrackSummary[];
  selectedTrackId: number | null;
  currentTrackId: number | null;
  tracksLoading: boolean;
  tracksError: string;
  playlists: Playlist[];
  playlistsLoading: boolean;
  playlistsError: string;
  trackActionPending: boolean;
}>();

const emit = defineEmits<{
  close: [];
  selectTrack: [trackId: number];
  playTrack: [trackId: number];
  playAlbum: [];
  refreshPlaylists: [];
  addToNext: [trackId: number];
  addToQueueEnd: [trackId: number];
  addTrackToPlaylist: [trackId: number, playlistId: number];
  deleteTrack: [trackId: number];
}>();

const { focusedItem, setFocusedItem } = useClickFocus();
const albumHeadingElement = ref<InstanceType<typeof globalThis.HTMLHeadingElement> | null>(null);
const contextMenuElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const firstMenuItemElement = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const playlistMenuTriggerElement = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(
  null,
);
const playlistMenuElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const playlistMenuItemElements = ref<InstanceType<typeof globalThis.HTMLButtonElement>[]>([]);
const contextMenu = shallowRef<TrackContextMenuRequest | null>(null);
const menuPosition = ref({ x: 0, y: 0 });
const playlistMenuPosition = ref({ x: 0, y: 0 });
const isPlaylistMenuOpen = ref(false);

function getTrackFocusKey(id: number) {
  return `album-track:${id}`;
}

function selectTrack(trackId: number) {
  setFocusedItem(getTrackFocusKey(trackId));
  emit("selectTrack", trackId);
}

function clampMenuPosition(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(0, Math.min(x, globalThis.innerWidth - width)),
    y: Math.max(0, Math.min(y, globalThis.innerHeight - height)),
  };
}

function openTrackContextMenu(request: TrackContextMenuRequest) {
  contextMenu.value = request;
  isPlaylistMenuOpen.value = false;
  menuPosition.value = clampMenuPosition(request.x, request.y, 256, 240);
  emit("refreshPlaylists");
  void nextTick(() => {
    firstMenuItemElement.value?.focus();
    const bounds = contextMenuElement.value?.getBoundingClientRect();
    if (bounds)
      menuPosition.value = clampMenuPosition(request.x, request.y, bounds.width, bounds.height);
  });
}

function closeTrackContextMenu(restoreFocus: boolean) {
  const trigger = contextMenu.value?.trigger;
  contextMenu.value = null;
  isPlaylistMenuOpen.value = false;
  if (!restoreFocus) return;

  void nextTick(() => {
    if (trigger?.isConnected) trigger.focus();
    else albumHeadingElement.value?.focus();
  });
}

function closeTrackContextMenuOnOutsidePointer(
  event: InstanceType<typeof globalThis.PointerEvent>,
) {
  if (!contextMenu.value) return;
  if (event.target instanceof globalThis.Node && contextMenuElement.value?.contains(event.target)) {
    return;
  }
  closeTrackContextMenu(false);
}

function closeTrackContextMenuOnEscape(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (event.key !== "Escape" || !contextMenu.value) return;
  event.preventDefault();
  closeTrackContextMenu(true);
}

function positionPlaylistMenu() {
  const contextMenuBounds = contextMenuElement.value?.getBoundingClientRect();
  const triggerBounds = playlistMenuTriggerElement.value?.getBoundingClientRect();
  const playlistMenuBounds = playlistMenuElement.value?.getBoundingClientRect();
  if (!contextMenuBounds || !triggerBounds || !playlistMenuBounds) return;

  const fitsOnRight = contextMenuBounds.right + playlistMenuBounds.width <= globalThis.innerWidth;
  const x = fitsOnRight
    ? contextMenuBounds.right
    : contextMenuBounds.left - playlistMenuBounds.width;
  playlistMenuPosition.value = clampMenuPosition(
    x,
    triggerBounds.top,
    playlistMenuBounds.width,
    playlistMenuBounds.height,
  );
}

function openPlaylistMenu(focusFirst = false) {
  const wasOpen = isPlaylistMenuOpen.value;
  isPlaylistMenuOpen.value = true;
  if (!wasOpen) emit("refreshPlaylists");

  void nextTick(() => {
    positionPlaylistMenu();
    if (focusFirst) playlistMenuItemElements.value[0]?.focus();
  });
}

function closePlaylistMenuOnPointerLeave() {
  isPlaylistMenuOpen.value = false;
}

function runTrackMenuAction(action: "addToNext" | "addToQueueEnd" | "deleteTrack") {
  const trackId = contextMenu.value?.trackId;
  if (trackId === undefined) return;
  closeTrackContextMenu(true);

  if (action === "addToNext") emit("addToNext", trackId);
  else if (action === "addToQueueEnd") emit("addToQueueEnd", trackId);
  else emit("deleteTrack", trackId);
}

function addToNext() {
  runTrackMenuAction("addToNext");
}

function addToQueueEnd() {
  runTrackMenuAction("addToQueueEnd");
}

function addTrackToPlaylist(playlistId: number) {
  const trackId = contextMenu.value?.trackId;
  if (trackId === undefined) return;
  closeTrackContextMenu(true);
  emit("addTrackToPlaylist", trackId, playlistId);
}

function requestTrackDeletion() {
  runTrackMenuAction("deleteTrack");
}

watch(
  () => {
    const request = contextMenu.value;
    return request === null || props.tracks.some((track) => track.id === request.trackId);
  },
  (isTargetStillVisible) => {
    if (!isTargetStillVisible) closeTrackContextMenu(true);
  },
);

watch(
  () => [props.playlists.length, props.playlistsLoading, props.playlistsError],
  () => {
    if (isPlaylistMenuOpen.value) void nextTick(positionPlaylistMenu);
  },
);

onMounted(() => {
  globalThis.document.addEventListener("pointerdown", closeTrackContextMenuOnOutsidePointer);
  globalThis.document.addEventListener("keydown", closeTrackContextMenuOnEscape);
});

onUnmounted(() => {
  globalThis.document.removeEventListener("pointerdown", closeTrackContextMenuOnOutsidePointer);
  globalThis.document.removeEventListener("keydown", closeTrackContextMenuOnEscape);
});
</script>

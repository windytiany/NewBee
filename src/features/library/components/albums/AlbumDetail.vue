<template>
  <article
    class="bg-app-interactive relative rounded-lg px-5 py-5 text-white shadow-xl ring-1 ring-white/10 sm:px-7"
    :class="props.background ? '[--app-muted:#e5e7eb] [--app-text:#fff]' : ''"
  >
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 rounded-[inherit] bg-cover transition-opacity duration-200 motion-reduce:transition-none"
      :class="props.background ? 'opacity-100' : 'opacity-0'"
      :style="backgroundStyle"
    ></div>
    <header class="relative mb-5 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-3">
          <h2
            ref="albumHeadingElement"
            class="min-w-0 flex-1 truncate text-xl font-bold sm:text-2xl"
            tabindex="-1"
          >
            {{ props.album.album ?? t("未知专辑") }}
          </h2>
          <button
            :aria-label="playbackButtonLabel"
            class="focus-visible:outline-app-accent bg-app-accent grid size-9 shrink-0 place-items-center rounded-full text-black focus-visible:outline-2"
            :class="
              playbackButtonDisabled
                ? 'cursor-not-allowed opacity-50'
                : 'hover:scale-105 active:scale-95'
            "
            :disabled="playbackButtonDisabled"
            :title="playbackButtonLabel"
            type="button"
            @click="activatePlayback"
          >
            <Pause
              v-if="isCurrentAlbum && props.isPlaying"
              aria-hidden="true"
              class="size-4 fill-current"
            />
            <Play v-else aria-hidden="true" class="ml-0.5 size-4 fill-current" />
          </button>
        </div>
        <p class="text-app-muted mt-1 truncate text-base">
          {{ props.albumArtist ?? t("未知演出者") }} ({{ props.album.year ?? t("年份未知") }})
        </p>
      </div>
      <button
        :aria-label="t('收起专辑曲目')"
        class="focus-visible:outline-app-accent text-app-muted grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2"
        type="button"
        @click="emit('close')"
      >
        <X aria-hidden="true" class="size-4" />
      </button>
    </header>

    <h3 class="sr-only">{{ t("曲目") }}</h3>

    <div
      v-if="!props.tracksLoading && !props.tracksError && props.tracks.length > 0"
      ref="trackListElement"
      class="relative grid gap-x-8 gap-y-6"
      @keydown="trackKeyboard.onKeydown"
      @focusin="trackKeyboard.onFocusin"
    >
      <ol
        v-for="disc in trackDiscs"
        :key="disc.number"
        :aria-label="t('第 {count} 碟', { count: disc.number })"
        class="grid gap-x-8"
        :class="trackColumnCount === 2 ? 'grid-flow-col grid-cols-2' : 'grid-cols-1'"
        :style="{
          gridTemplateRows: `repeat(${Math.ceil(disc.tracks.length / trackColumnCount)}, auto)`,
        }"
      >
        <AlbumTrack
          v-for="track in disc.tracks"
          :key="track.id"
          :track="track"
          :album-artist="props.albumArtist"
          :is-focused="trackFocus.isFocused(String(track.id))"
          :is-selected="trackFocus.isSelected(String(track.id))"
          :is-current-track="track.id === props.currentTrackId"
          :is-context-menu-open="contextMenu?.payload.itemKey === String(track.id)"
          @select="selectTrack(track.id, $event)"
          @play="emit('playTrack', track.id)"
          @context-menu="openTrackContextMenu"
        />
      </ol>
    </div>
    <p
      v-else-if="!props.tracksLoading && !props.tracksError"
      class="text-app-muted relative py-3 text-sm"
    >
      {{ t("无曲目") }}
    </p>

    <div
      v-if="contextMenu"
      id="album-track-context-menu"
      ref="contextMenuElement"
      data-item-interaction
      class="bg-app-interactive fixed z-100 w-64 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      role="menu"
      :aria-label="t('专辑曲目操作')"
      @pointerdown.stop
      @pointerleave="closePlaylistMenuOnPointerLeave"
    >
      <button
        ref="firstMenuItemElement"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
        role="menuitem"
        :disabled="props.trackActionPending"
        type="button"
        @click.stop="addToNext"
      >
        {{ t("添加为下一首") }}
      </button>
      <button
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
        role="menuitem"
        :disabled="props.trackActionPending"
        type="button"
        @click.stop="addToQueueEnd"
      >
        {{ t("添加到队尾") }}
      </button>
      <button
        ref="playlistMenuTriggerElement"
        class="focus-visible:outline-app-accent flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm focus-visible:outline-2"
        :class="isPlaylistMenuOpen ? 'bg-app-accent text-black' : 'text-white hover:bg-white/10'"
        role="menuitem"
        aria-haspopup="menu"
        :aria-expanded="isPlaylistMenuOpen"
        :aria-controls="isPlaylistMenuOpen ? 'album-track-playlist-menu' : undefined"
        :disabled="props.trackActionPending"
        type="button"
        @mouseenter="openPlaylistMenu()"
        @click.stop="openPlaylistMenu(true)"
      >
        {{ t("添加到播放列表") }}
        <ChevronRight aria-hidden="true" class="size-4" />
      </button>
      <div
        v-if="isPlaylistMenuOpen"
        id="album-track-playlist-menu"
        ref="playlistMenuElement"
        class="bg-app-interactive fixed z-101 max-h-72 w-56 overflow-y-auto rounded-md p-1 shadow-xl ring-1 ring-white/10"
        :style="{ left: `${playlistMenuPosition.x}px`, top: `${playlistMenuPosition.y}px` }"
        role="menu"
        :aria-label="t('选择目标歌单')"
      >
        <button
          ref="createPlaylistMenuItemElement"
          class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
          role="menuitem"
          :disabled="props.trackActionPending"
          type="button"
          @click.stop="createPlaylistWithTracks"
        >
          {{ t("新建播放列表…") }}
        </button>
        <div class="my-1 border-t border-white/10" role="separator"></div>
        <p
          v-if="!props.playlistsLoading && !props.playlistsError && props.playlists.length === 0"
          class="text-app-muted px-2 py-2 text-sm"
        >
          {{ t("无歌单") }}
        </p>
        <button
          v-for="playlist in props.playlists"
          v-else-if="!props.playlistsLoading && !props.playlistsError"
          :key="playlist.id"
          class="focus-visible:outline-app-accent w-full truncate rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2"
          role="menuitem"
          :disabled="props.trackActionPending"
          type="button"
          @click.stop="addTracksToPlaylist(playlist.id)"
        >
          {{ playlist.name }}
        </button>
      </div>
      <EditMenuItem
        :track-ids="contextMenu.payload.targetTrackIds"
        :disabled="props.trackActionPending"
        @close="closeTrackContextMenu(true)"
      />
      <DownloadMenuItem
        :track-ids="contextMenu.payload.targetTrackIds"
        :disabled="props.trackActionPending"
        @close="closeTrackContextMenu(true)"
      />
      <SkipMenuItem
        :track-ids="contextMenu.payload.targetTrackIds"
        :disabled="props.trackActionPending"
        @close="closeTrackContextMenu(true)"
      />
      <div class="my-1 border-t border-white/10" role="separator"></div>
      <button
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-red-200 hover:bg-white/10 focus-visible:outline-2"
        role="menuitem"
        :disabled="props.trackActionPending || contextMenu.payload.targetTrackIds.length !== 1"
        :title="
          contextMenu.payload.targetTrackIds.length !== 1
            ? t('多选时暂不支持从曲库删除')
            : undefined
        "
        type="button"
        @click.stop="requestTrackDeletion"
      >
        {{ t("从库中删除") }}
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, nextTick, ref, watch } from "vue";
import { ChevronRight, Pause, Play, X } from "@lucide/vue";
import { useContextMenu } from "@/shared/interaction/useContextMenu";
import { useItemSelection } from "@/shared/interaction/item/useSelection";
import { createItemKeyboard } from "@/shared/interaction/item/keyboard";
import type { ItemSelectionModifiers } from "@/shared/interaction/item/useSelection";
import type { AlbumSummary, TrackSummary } from "@/features/library/types";
import type { AlbumBackground } from "@/features/artwork/background";
import type { PlaylistSummary } from "@/features/playlist/types";
import AlbumTrack from "@/features/library/components/albums/AlbumTrack.vue";
import SkipMenuItem from "@/features/playback/queue/components/SkipMenuItem.vue";
import EditMenuItem from "@/features/tags/manual/components/EditMenuItem.vue";
import DownloadMenuItem from "@/features/lyrics/components/DownloadMenuItem.vue";
import { useTrackColumns } from "@/features/library/composables/useTrackColumns";

type TrackContextMenuTrigger = {
  trackId: number;
  x: number;
  y: number;
  trigger: InstanceType<typeof globalThis.HTMLButtonElement>;
};

type AlbumTrackContextMenuPayload = {
  itemKey: string;
  targetTrackIds: number[];
};

const props = defineProps<{
  album: AlbumSummary;
  background?: AlbumBackground | null;
  albumArtist: string | null;
  tracks: TrackSummary[];
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackCommandPending: boolean;
  tracksLoading: boolean;
  tracksError: string;
  playlists: readonly PlaylistSummary[];
  playlistsLoading: boolean;
  playlistsError: string;
  trackActionPending: boolean;
}>();

const emit = defineEmits<{
  close: [];
  playTrack: [trackId: number];
  playAlbum: [];
  togglePlayback: [];
  refreshPlaylists: [];
  addTracksToNext: [trackIds: number[]];
  addTracksToQueueEnd: [trackIds: number[]];
  addTracksToPlaylist: [trackIds: number[], playlistId: number];
  createPlaylistWithTracks: [trackIds: number[]];
  deleteTrack: [trackId: number];
}>();

const isCurrentAlbum = computed(() =>
  props.tracks.some((track) => track.id === props.currentTrackId),
);
const playbackButtonLabel = computed(() =>
  isCurrentAlbum.value
    ? props.isPlaying
      ? t("暂停当前曲目")
      : t("继续播放当前曲目")
    : t("播放专辑"),
);
const playbackButtonDisabled = computed(
  () =>
    props.trackActionPending ||
    props.playbackCommandPending ||
    props.tracksLoading ||
    props.tracks.length === 0,
);

function activatePlayback() {
  if (playbackButtonDisabled.value) return;
  if (isCurrentAlbum.value) emit("togglePlayback");
  else emit("playAlbum");
}

const backgroundStyle = computed(() => ({
  backgroundImage: props.background
    ? `linear-gradient(to bottom, ${props.background.color}, transparent 48px), url("${props.background.imageUrl}")`
    : undefined,
  backgroundSize: "100% 100%",
}));

const trackDiscs = computed(() => {
  const discs = new Map<number, TrackSummary[]>();
  for (const track of props.tracks) {
    const number = track.discNumber ?? 1;
    const tracks = discs.get(number);
    if (tracks) tracks.push(track);
    else discs.set(number, [track]);
  }
  return [...discs]
    .sort(([left], [right]) => left - right)
    .map(([number, tracks]) => ({ number, tracks }));
});

const trackListElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const trackColumnCount = useTrackColumns(trackListElement);

const trackListScope = computed(() =>
  JSON.stringify(["library", "album-tracks", props.albumArtist, props.album.album]),
);
const trackFocus = useItemSelection(trackListScope);
const visibleTrackKeys = computed(() =>
  trackDiscs.value.flatMap((disc) => disc.tracks.map((track) => String(track.id))),
);

const trackKeyboard = createItemKeyboard({
  getItemKeys: () => visibleTrackKeys.value,
  itemSelector: "button[data-album-track-row]",
  grid: true,
  onFocus: (key) => {
    if (!trackFocus.isFocused(key)) trackFocus.focusItem(key);
  },
  onMove: (key, event) => trackFocus.selectItem(key, visibleTrackKeys.value, event),
  onActivate: (key) => {
    if (!props.trackActionPending && !props.playbackCommandPending && !props.tracksLoading) {
      emit("playTrack", Number(key));
    }
  },
  onEscape: () => emit("close"),
});

watch(visibleTrackKeys, (itemKeys) => trackFocus.syncVisibleItems(itemKeys), {
  immediate: true,
});
const albumHeadingElement = ref<InstanceType<typeof globalThis.HTMLHeadingElement> | null>(null);
const contextMenuElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const firstMenuItemElement = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const playlistMenuTriggerElement = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(
  null,
);
const playlistMenuElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const createPlaylistMenuItemElement = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(
  null,
);
const {
  request: contextMenu,
  position: menuPosition,
  open: openContextMenu,
  close: closeContextMenu,
} = useContextMenu<AlbumTrackContextMenuPayload>({
  menuElement: contextMenuElement,
  firstMenuItemElement,
  fallbackFocusElement: albumHeadingElement,
});
const playlistMenuPosition = ref({ x: 0, y: 0 });
const isPlaylistMenuOpen = ref(false);

function selectTrack(trackId: number, modifiers: ItemSelectionModifiers) {
  trackFocus.selectItem(String(trackId), visibleTrackKeys.value, modifiers);
}

function getContextTargetTrackIds(itemKeys: readonly string[]) {
  const targetKeys = new Set(itemKeys);
  return props.tracks.flatMap((track) => (targetKeys.has(String(track.id)) ? [track.id] : []));
}

function clampMenuPosition(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(0, Math.min(x, globalThis.innerWidth - width)),
    y: Math.max(0, Math.min(y, globalThis.innerHeight - height)),
  };
}

function openTrackContextMenu(request: TrackContextMenuTrigger) {
  const itemKey = String(request.trackId);
  const targetKeys = trackFocus.contextMenuTargets(itemKey, visibleTrackKeys.value);
  const targetTrackIds = getContextTargetTrackIds(targetKeys);
  if (targetTrackIds.length === 0) return;

  isPlaylistMenuOpen.value = false;
  openContextMenu({
    x: request.x,
    y: request.y,
    trigger: request.trigger,
    payload: { itemKey, targetTrackIds },
  });
  emit("refreshPlaylists");
}

function closeTrackContextMenu(restoreFocus: boolean) {
  isPlaylistMenuOpen.value = false;
  closeContextMenu(restoreFocus);
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
    if (focusFirst) createPlaylistMenuItemElement.value?.focus();
  });
}

function closePlaylistMenuOnPointerLeave() {
  isPlaylistMenuOpen.value = false;
}

function runTrackMenuAction(action: "addToNext" | "addToQueueEnd" | "deleteTrack") {
  const targetTrackIds = contextMenu.value?.payload.targetTrackIds;
  if (!targetTrackIds?.length || (action === "deleteTrack" && targetTrackIds.length !== 1)) return;
  closeTrackContextMenu(true);

  if (action === "addToNext") emit("addTracksToNext", targetTrackIds);
  else if (action === "addToQueueEnd") emit("addTracksToQueueEnd", targetTrackIds);
  else emit("deleteTrack", targetTrackIds[0]!);
}

function addToNext() {
  runTrackMenuAction("addToNext");
}

function addToQueueEnd() {
  runTrackMenuAction("addToQueueEnd");
}

function addTracksToPlaylist(playlistId: number) {
  const targetTrackIds = contextMenu.value?.payload.targetTrackIds;
  if (!targetTrackIds?.length) return;
  closeTrackContextMenu(true);
  emit("addTracksToPlaylist", targetTrackIds, playlistId);
}

function createPlaylistWithTracks() {
  const targetTrackIds = contextMenu.value?.payload.targetTrackIds;
  if (!targetTrackIds?.length || props.trackActionPending) return;
  const trackIds = [...targetTrackIds];
  closeTrackContextMenu(false);
  emit("createPlaylistWithTracks", trackIds);
}

function requestTrackDeletion() {
  if (contextMenu.value?.payload.targetTrackIds.length !== 1) return;
  runTrackMenuAction("deleteTrack");
}

watch(contextMenu, (request) => {
  if (request === null) isPlaylistMenuOpen.value = false;
});

watch(trackListScope, () => closeTrackContextMenu(false));

watch(
  () => {
    const request = contextMenu.value;
    return (
      request === null ||
      request.payload.targetTrackIds.every((trackId) =>
        props.tracks.some((track) => track.id === trackId),
      )
    );
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
</script>

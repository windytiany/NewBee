<template>
  <section
    ref="browserElement"
    data-keyboard-list
    data-keyboard-grid
    data-local-drop="Library"
    data-focus-region
    :aria-labelledby="props.artist ? 'album-browser-heading' : undefined"
    :aria-label="props.artist ? undefined : t('专辑')"
    :aria-busy="props.trackActionPending || props.albumsLoading"
    class="bg-app-base flex h-full min-h-0 w-full min-w-0 flex-col text-white"
    @keydown="handleAlbumKeydown"
    @focusin="albumKeyboard.onFocusin"
  >
    <template v-if="props.artist">
      <header
        class="bg-app-interactive flex shrink-0 items-center gap-4 border-b border-white/10 px-4 py-3 sm:gap-5 sm:px-5 sm:py-4"
      >
        <PhotoEditor :artist="props.artist.artist" class="size-28 sm:size-36" />
        <h1
          id="album-browser-heading"
          class="min-w-0 text-3xl font-bold tracking-tight break-words sm:text-4xl"
        >
          {{ props.artist.artist ?? t("未知演出者") }}
        </h1>
      </header>
      <div class="flex min-h-0 flex-1">
        <div
          ref="albumsElement"
          v-persistent-scroll="albumListScope"
          class="sidebar-scrollbars min-h-0 min-w-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto [overflow-anchor:none]"
        >
          <p
            v-if="!props.albumsLoading && !props.albumsError && props.albums.length === 0"
            class="text-app-muted px-4 py-3 text-sm sm:px-5"
          >
            {{ t("无专辑") }}
          </p>
          <div
            v-else-if="!props.albumsLoading && !props.albumsError"
            ref="albumGridElement"
            class="grid gap-4 px-4 pt-3 pb-6 sm:gap-x-6 sm:px-5"
            :style="{ gridTemplateColumns }"
          >
            <AlbumCard
              v-for="(album, index) in props.albums"
              :key="getAlbumKey(album)"
              :album="album"
              :style="{ order: index * 2 }"
              :album-artist="album.albumArtist"
              :cover-index="index"
              :is-selected="isSelectedAlbum(album)"
              :is-focused="albumFocus.isFocused(getAlbumKey(album))"
              :is-context-menu-open="
                albumMenu?.contextMenu?.payload.album === album.album &&
                albumMenu?.contextMenu?.payload.albumArtist === album.albumArtist
              "
              @select="toggleAlbum(album)"
              @play="playAlbum(album)"
              @context-menu="openAlbumContextMenu(album, $event)"
            />
            <div
              v-if="selectedAlbum"
              class="relative"
              :style="{
                gridColumn: '1 / -1',
                order: (Math.floor(selectedAlbumIndex / columnCount) + 1) * columnCount * 2 - 1,
                '--album-background-color': selectedArtwork.background.value
                  ? `color-mix(in srgb, var(--app-cover-tint) var(--app-cover-mix), ${selectedArtwork.background.value.color})`
                  : undefined,
              }"
            >
              <div
                aria-hidden="true"
                class="pointer-events-none absolute inset-x-0 top-px z-10 grid gap-x-4 sm:gap-x-6"
                :style="{ gridTemplateColumns }"
              >
                <span
                  class="border-b-app-interactive -translate-y-full justify-self-center border-x-12 border-b-12 border-x-transparent"
                  :style="{
                    gridColumn: (selectedAlbumIndex % columnCount) + 1,
                    borderBottomColor: 'var(--album-background-color, var(--app-interactive))',
                  }"
                ></span>
              </div>
              <AlbumDetail
                :album="selectedAlbum"
                :background="selectedArtwork.background.value"
                :album-artist="selectedAlbum.albumArtist"
                :tracks="props.tracks"
                :current-track-id="props.currentTrackId"
                :is-playing="props.isPlaying"
                :playback-command-pending="props.playbackCommandPending"
                :tracks-loading="props.tracksLoading"
                :tracks-error="props.tracksError"
                :playlists="props.playlists"
                :playlists-loading="props.playlistsLoading"
                :playlists-error="props.playlistsError"
                :track-action-pending="props.trackActionPending"
                @close="closeAlbum(selectedAlbum)"
                @play-track="emit('playTrack', $event)"
                @play-album="playAlbum(selectedAlbum)"
                @toggle-playback="emit('togglePlayback')"
                @refresh-playlists="emit('refreshPlaylists')"
                @add-tracks-to-next="emit('addTracksToNext', $event)"
                @add-tracks-to-queue-end="emit('addTracksToQueueEnd', $event)"
                @add-tracks-to-playlist="addTracksToPlaylist"
                @create-playlist-with-tracks="createPlaylistWithTracks"
                @delete-track="emit('deleteTrack', $event)"
              />
            </div>
          </div>
        </div>
        <LibraryStatistics :albums="props.albumsLoading || props.albumsError ? [] : props.albums" />
      </div>
    </template>
    <p v-else class="text-app-muted px-5 py-6 text-sm sm:px-8">{{ t("请选择演出者") }}</p>
    <AlbumContextMenu
      ref="albumMenu"
      :scope="albumListScope"
      :album-keys="albumItemKeys"
      :pending="props.trackActionPending"
      :playlists="props.playlists"
      :playlists-loading="props.playlistsLoading"
      :playlists-error="props.playlistsError"
      @refresh-playlists="emit('refreshPlaylists')"
      @add-to-next="emit('addAlbumToNext', $event)"
      @add-to-queue-end="emit('addAlbumToQueueEnd', $event)"
      @add-to-playlist="(album, playlistId) => emit('addAlbumToPlaylist', album, playlistId)"
      @create-playlist-with-album="createPlaylistWithAlbum"
      @delete-album="emit('deleteAlbum', $event)"
    />
    <CreatePlaylistDialog ref="createPlaylistDialog" @created="emit('refreshPlaylists')" />
  </section>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { createItemKeyboard } from "@/shared/interaction/item/keyboard";
import { vPersistentScroll } from "@/shared/interaction/scroll/persistence";
import { useItemSelection } from "@/shared/interaction/item/useSelection";
import { ALBUM_BACKGROUND_SAMPLE_SIZE } from "@/features/artwork/background";
import { useAlbumArtwork } from "@/features/artwork/album/useArtwork";
import { useCoverBackground } from "@/features/settings/appearance/useCoverBackground";
import LibraryStatistics from "@/features/library/statistics/LibraryStatistics.vue";
import { ALBUM_COLUMN_WIDTH } from "@/features/library/layout";
import { useAlbumScroll } from "@/features/library/browser/albums/scroll";
import { layoutDensity } from "@/features/settings/appearance/layout";
import type { ArtistSummary, ArtistGrouping } from "@/features/artists/types";
import type { LibraryAlbumSelection, AlbumSummary } from "@/features/library/types";
import type { TrackSummary } from "@/features/tracks/types";

import type { PlaylistSummary } from "@/features/playlist/types";
import PhotoEditor from "@/features/artwork/artist/PhotoEditor.vue";
import AlbumDetail from "@/features/library/browser/albums/AlbumDetail.vue";
import AlbumCard from "@/features/library/browser/albums/AlbumCard.vue";
import AlbumContextMenu from "@/features/library/browser/albums/AlbumContextMenu.vue";
import { createLibraryApi } from "@/features/library/api";
import CreatePlaylistDialog from "@/features/playlist/creation/CreatePlaylistDialog.vue";

const props = defineProps<{
  artist: ArtistSummary | null;
  grouping: ArtistGrouping;
  albums: AlbumSummary[];
  selectedAlbum: LibraryAlbumSelection | null;
  tracks: TrackSummary[];
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackCommandPending: boolean;
  albumsLoading: boolean;
  albumsError: string;
  tracksLoading: boolean;
  tracksError: string;
  playlists: readonly PlaylistSummary[];
  playlistsLoading: boolean;
  playlistsError: string;
  trackActionPending: boolean;
}>();

const emit = defineEmits<{
  selectAlbum: [album: AlbumSummary | null];
  playTrack: [trackId: number];
  playAlbum: [album: LibraryAlbumSelection];
  togglePlayback: [];
  refreshPlaylists: [];
  addTracksToNext: [trackIds: number[]];
  addTracksToQueueEnd: [trackIds: number[]];
  addTracksToPlaylist: [trackIds: number[], playlistId: number];
  deleteTrack: [trackId: number];
  addAlbumToNext: [album: LibraryAlbumSelection];
  addAlbumToQueueEnd: [album: LibraryAlbumSelection];
  addAlbumToPlaylist: [album: LibraryAlbumSelection, playlistId: number];
  deleteAlbum: [album: LibraryAlbumSelection];
}>();

const albumCoverBackground = useCoverBackground("albumCoverBackground");
const selectedArtwork = useAlbumArtwork(
  () => (albumCoverBackground.value ? props.selectedAlbum : null),
  "background",
  ALBUM_BACKGROUND_SAMPLE_SIZE,
);
const albumMenu = ref<InstanceType<typeof AlbumContextMenu> | null>(null);

function openAlbumContextMenu(
  album: AlbumSummary,
  request: { x: number; y: number; trigger: InstanceType<typeof globalThis.HTMLButtonElement> },
) {
  if (!props.artist) return;
  albumFocus.focusItem(getAlbumKey(album));
  albumMenu.value?.open({
    ...request,
    album: albumSelection(album),
  });
}

const albumsElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const columnCount = ref(2);
const gridTemplateColumns = computed(() => `repeat(${columnCount.value}, minmax(0, 1fr))`);
const albumListScope = computed(() =>
  JSON.stringify(["library", "albums", props.grouping, props.artist?.artist ?? null]),
);
const albumFocus = useItemSelection(albumListScope);

const albumItemKeys = computed(() => props.albums.map(getAlbumKey));
const browserElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const albumKeyboard = createItemKeyboard({
  getItemKeys: () => albumItemKeys.value,
  itemSelector: "button[data-album-card]",
  grid: true,
  onFocus: (key) => {
    if (!albumFocus.isFocused(key)) albumFocus.focusItem(key);
  },
  onMove: (key) => albumFocus.focusItem(key),
  onActivate: (key) => {
    const album = props.albums.find((entry) => getAlbumKey(entry) === key);
    if (!album) return;
    if (!isSelectedAlbum(album)) toggleAlbum(album);
    void nextTick(() =>
      browserElement.value
        ?.querySelector<globalThis.HTMLElement>("button[data-album-track-row]")
        ?.focus(),
    );
  },
});

function handleAlbumKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (
    event.key === "Escape" &&
    selectedAlbum.value &&
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.target instanceof globalThis.Element &&
    !event.target.closest('dialog, [role="menu"], input, textarea, select, [contenteditable]')
  ) {
    event.preventDefault();
    event.stopPropagation();
    closeAlbum(selectedAlbum.value);
    return;
  }
  if (
    !props.selectedAlbum ||
    event.ctrlKey ||
    event.shiftKey ||
    !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
  ) {
    albumKeyboard.onKeydown(event);
    return;
  }
  if (event.defaultPrevented || event.altKey || event.metaKey || event.isComposing) return;
  if (
    !(event.target instanceof globalThis.Element) ||
    !event.target.closest("button[data-album-card]")
  )
    return;

  event.preventDefault();
  event.stopPropagation();
  if (event.key !== "ArrowDown") return;
  const track = browserElement.value?.querySelector<InstanceType<typeof globalThis.HTMLElement>>(
    "button[data-album-track-row]",
  );
  track?.focus({ preventScroll: true });
  track?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

watch(albumItemKeys, (itemKeys) => albumFocus.syncVisibleItems(itemKeys), { immediate: true });

const selectedAlbumIndex = computed(() => props.albums.findIndex(isSelectedAlbum));
const selectedAlbum = computed(() => props.albums[selectedAlbumIndex.value] ?? null);
const albumGridElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);

useAlbumScroll({
  viewport: albumsElement,
  grid: albumGridElement,
  selectedIndex: selectedAlbumIndex,
  columns: columnCount,
  albumCount: computed(() => props.albums.length),
  loading: computed(() => props.albumsLoading || props.tracksLoading),
});

function updateColumnCount() {
  const width = albumsElement.value?.clientWidth ?? globalThis.window.innerWidth;
  if (width <= 0) return;
  const compact = layoutDensity.value === "compact";
  columnCount.value = Math.max(
    1,
    Math.min(compact ? 5 : 4, Math.floor(width / ALBUM_COLUMN_WIDTH[layoutDensity.value])),
  );
}

watch(layoutDensity, updateColumnCount);
let resizeObserver: InstanceType<typeof globalThis.ResizeObserver> | undefined;
watch(albumsElement, (element, previous) => {
  if (previous) resizeObserver?.unobserve(previous);
  if (element) resizeObserver?.observe(element);
  updateColumnCount();
});

onMounted(() => {
  if (typeof globalThis.ResizeObserver !== "undefined") {
    resizeObserver = new globalThis.ResizeObserver(updateColumnCount);
    if (albumsElement.value) resizeObserver.observe(albumsElement.value);
  }
  updateColumnCount();
  globalThis.window.addEventListener("resize", updateColumnCount);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  globalThis.window.removeEventListener("resize", updateColumnCount);
});

function getAlbumKey(album: AlbumSummary) {
  return JSON.stringify([album.albumArtist, album.album]);
}

function isSelectedAlbum(album: AlbumSummary) {
  return (
    props.artist !== null &&
    props.selectedAlbum !== null &&
    props.selectedAlbum.albumArtist === album.albumArtist &&
    props.selectedAlbum.album === album.album
  );
}

function toggleAlbum(album: AlbumSummary) {
  albumFocus.focusItem(getAlbumKey(album));
  emit("selectAlbum", isSelectedAlbum(album) ? null : album);
}

function albumSelection(album: AlbumSummary): LibraryAlbumSelection {
  return {
    albumArtist: album.albumArtist,
    album: album.album,
    ...(props.grouping === "artist"
      ? { group: { grouping: props.grouping, artist: props.artist?.artist ?? null } }
      : {}),
  };
}

function playAlbum(album: AlbumSummary) {
  if (!props.artist || props.trackActionPending) return;
  albumFocus.focusItem(getAlbumKey(album));
  emit("playAlbum", albumSelection(album));
}

function closeAlbum(album: AlbumSummary) {
  albumFocus.focusItem(getAlbumKey(album));
  emit("selectAlbum", null);
  void nextTick(() => {
    const index = props.albums.findIndex((entry) => getAlbumKey(entry) === getAlbumKey(album));
    browserElement.value
      ?.querySelectorAll<InstanceType<typeof globalThis.HTMLElement>>("button[data-album-card]")
      [index]?.focus({ preventScroll: true });
  });
}

const createPlaylistDialog = ref<InstanceType<typeof CreatePlaylistDialog> | null>(null);
const libraryApi = createLibraryApi();

function createPlaylistWithTracks(trackIds: number[]) {
  if (props.trackActionPending) return;
  const ids = [...trackIds];
  createPlaylistDialog.value?.show(async () => ids);
}

function createPlaylistWithAlbum(album: LibraryAlbumSelection) {
  if (props.trackActionPending) return;
  const selection = { ...album };
  createPlaylistDialog.value?.show(async () => {
    const tracks = await libraryApi.listAlbumTracks(selection);
    return tracks.map((track) => track.id);
  });
}

function addTracksToPlaylist(trackIds: number[], playlistId: number) {
  emit("addTracksToPlaylist", trackIds, playlistId);
}
</script>

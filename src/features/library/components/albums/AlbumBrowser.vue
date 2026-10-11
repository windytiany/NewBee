<template>
  <section
    ref="browserElement"
    aria-labelledby="album-browser-heading"
    :aria-busy="props.trackActionPending || props.albumsLoading"
    class="sidebar-scrollbars bg-app-base flex h-full min-h-0 w-full min-w-0 [scrollbar-gutter:stable] flex-col overflow-y-auto text-white"
    @keydown="handleAlbumKeydown"
    @focusin="albumKeyboard.onFocusin"
  >
    <template v-if="props.artist">
      <header class="shrink-0 px-5 py-6 sm:px-8 sm:py-8">
        <h1 id="album-browser-heading" class="text-3xl font-bold tracking-tight sm:text-4xl">
          {{ props.artist.albumArtist ?? t("未知演出者") }}
        </h1>
      </header>
      <p
        v-if="!props.albumsLoading && !props.albumsError && props.albums.length === 0"
        class="text-app-muted px-5 text-sm sm:px-8"
      >
        {{ t("无专辑") }}
      </p>
      <div
        v-else-if="!props.albumsLoading && !props.albumsError"
        class="flex flex-col gap-6 px-5 pb-8 sm:px-8"
      >
        <template v-for="row in albumRows" :key="row.id">
          <div class="grid grid-cols-2 gap-x-4 sm:grid-cols-3 sm:gap-x-6 xl:grid-cols-4">
            <AlbumCard
              v-for="(album, index) in row.albums"
              :key="getAlbumKey(album)"
              :album="album"
              :album-artist="props.artist.albumArtist"
              :cover-index="row.startIndex + index"
              :is-selected="isSelectedAlbum(album)"
              :is-focused="albumFocus.isFocused(getAlbumKey(album))"
              :is-context-menu-open="albumMenu?.contextMenu?.payload.album === album.album"
              @select="toggleAlbum(album)"
              @play="playAlbum(album)"
              @context-menu="openAlbumContextMenu(album, $event)"
            />
          </div>
          <div
            v-if="row.selectedAlbum"
            class="relative"
            :style="{ '--album-background-color': selectedArtwork.background.value?.color }"
          >
            <div
              aria-hidden="true"
              class="pointer-events-none absolute inset-x-0 top-px z-10 grid grid-cols-2 gap-x-4 sm:grid-cols-3 sm:gap-x-6 xl:grid-cols-4"
            >
              <span
                class="border-b-app-interactive -translate-y-full justify-self-center border-x-12 border-b-12 border-x-transparent"
                :style="{
                  gridColumn: row.albums.findIndex(isSelectedAlbum) + 1,
                  borderBottomColor: 'var(--album-background-color, var(--app-interactive))',
                }"
              ></span>
            </div>
            <AlbumDetail
              :album="row.selectedAlbum"
              :background="selectedArtwork.background.value"
              :album-artist="props.artist.albumArtist"
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
              @close="closeAlbum(row.selectedAlbum)"
              @play-track="emit('playTrack', $event)"
              @play-album="playAlbum(row.selectedAlbum)"
              @toggle-playback="emit('togglePlayback')"
              @refresh-playlists="emit('refreshPlaylists')"
              @add-tracks-to-next="emit('addTracksToNext', $event)"
              @add-tracks-to-queue-end="emit('addTracksToQueueEnd', $event)"
              @add-tracks-to-playlist="addTracksToPlaylist"
              @create-playlist-with-tracks="createPlaylistWithTracks"
              @delete-track="emit('deleteTrack', $event)"
            />
          </div>
        </template>
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
import { createItemKeyboard } from "@/shared/interaction/itemKeyboard";
import { useItemSelection } from "@/shared/interaction/useItemSelection";
import { ALBUM_BACKGROUND_SAMPLE_SIZE } from "@/features/artwork/background";
import { useAlbumArtwork } from "@/features/artwork/useAlbumArtwork";
import { useCoverBackground } from "@/features/settings/composables/useCoverBackground";
import type {
  LibraryAlbumSelection,
  AlbumArtistSummary,
  AlbumSummary,
  TrackSummary,
} from "@/features/library/types";

import type { PlaylistSummary } from "@/features/playlist/types";
import AlbumDetail from "@/features/library/components/albums/AlbumDetail.vue";
import AlbumCard from "@/features/library/components/albums/AlbumCard.vue";
import AlbumContextMenu from "@/features/library/components/albums/AlbumContextMenu.vue";
import { createLibraryApi } from "@/features/library/api";
import CreatePlaylistDialog from "@/features/playlist/components/dialogs/CreatePlaylistDialog.vue";

type AlbumBrowserRow = {
  id: string;
  startIndex: number;
  albums: AlbumSummary[];
  selectedAlbum: AlbumSummary | null;
};

const SMALL_SCREEN_BREAKPOINT = 640;
const WIDE_SCREEN_BREAKPOINT = 1280;

const props = defineProps<{
  artist: AlbumArtistSummary | null;
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
    album: { albumArtist: props.artist.albumArtist, album: album.album },
  });
}

const columnCount = ref(2);
const albumListScope = computed(() =>
  JSON.stringify(["library", "albums", props.artist?.albumArtist ?? null]),
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
    if (props.selectedAlbum) playAlbum(album);
    else toggleAlbum(album);
  },
});

function handleAlbumKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (
    !props.selectedAlbum ||
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

const albumRows = computed(() => {
  const rows: AlbumBrowserRow[] = [];

  for (let startIndex = 0; startIndex < props.albums.length; startIndex += columnCount.value) {
    const rowAlbums = props.albums.slice(startIndex, startIndex + columnCount.value);
    const firstAlbum = rowAlbums[0];
    if (!firstAlbum) continue;

    rows.push({
      id: getAlbumKey(firstAlbum),
      startIndex,
      albums: rowAlbums,
      selectedAlbum: rowAlbums.find(isSelectedAlbum) ?? null,
    });
  }

  return rows;
});

function updateColumnCount() {
  const viewportWidth = globalThis.window.innerWidth;
  columnCount.value =
    viewportWidth >= WIDE_SCREEN_BREAKPOINT ? 4 : viewportWidth >= SMALL_SCREEN_BREAKPOINT ? 3 : 2;
}

onMounted(() => {
  updateColumnCount();
  globalThis.window.addEventListener("resize", updateColumnCount);
});

onUnmounted(() => {
  globalThis.window.removeEventListener("resize", updateColumnCount);
});

function getAlbumKey(album: AlbumSummary) {
  return JSON.stringify([props.artist?.albumArtist ?? null, album.album]);
}

function isSelectedAlbum(album: AlbumSummary) {
  return (
    props.artist !== null &&
    props.selectedAlbum !== null &&
    props.selectedAlbum.albumArtist === props.artist.albumArtist &&
    props.selectedAlbum.album === album.album
  );
}

function toggleAlbum(album: AlbumSummary) {
  albumFocus.focusItem(getAlbumKey(album));
  emit("selectAlbum", isSelectedAlbum(album) ? null : album);
}

function playAlbum(album: AlbumSummary) {
  if (!props.artist || props.trackActionPending) return;
  albumFocus.focusItem(getAlbumKey(album));
  emit("playAlbum", { albumArtist: props.artist.albumArtist, album: album.album });
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

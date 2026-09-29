<template>
  <section
    aria-labelledby="album-browser-heading"
    class="sidebar-scrollbars bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto text-white"
  >
    <template v-if="props.artist">
      <header class="shrink-0 px-5 py-6 sm:px-8 sm:py-8">
        <h1 id="album-browser-heading" class="text-3xl font-bold tracking-tight sm:text-4xl">
          {{ props.artist.albumArtist ?? "未知演出者" }}
        </h1>
      </header>

      <p
        v-if="props.trackActionPending"
        class="text-spotify-muted px-5 text-sm sm:px-8"
        role="status"
      >
        正在处理曲目操作…
      </p>
      <p v-else-if="props.trackActionError" class="px-5 text-sm text-red-300 sm:px-8" role="alert">
        {{ props.trackActionError }}
      </p>
      <p v-if="props.albumsLoading" class="text-spotify-muted px-5 text-sm sm:px-8" role="status">
        正在读取专辑…
      </p>
      <p v-else-if="props.albumsError" class="px-5 text-sm text-red-300 sm:px-8" role="alert">
        {{ props.albumsError }}
      </p>
      <p v-else-if="props.albums.length === 0" class="text-spotify-muted px-5 text-sm sm:px-8">
        此专辑演出者暂无专辑。
      </p>
      <div v-else class="flex flex-col gap-6 px-5 pb-8 sm:px-8">
        <template v-for="row in albumRows" :key="row.id">
          <div class="grid grid-cols-2 gap-x-4 sm:grid-cols-3 sm:gap-x-6 xl:grid-cols-4">
            <AlbumCard
              v-for="(album, index) in row.albums"
              :key="getAlbumKey(album)"
              :album="album"
              :album-artist="props.artist.albumArtist"
              :cover-index="row.startIndex + index"
              :is-selected="isSelectedAlbum(album)"
              :is-focused="focusedItem === getAlbumFocusKey(album)"
              @select="toggleAlbum(album)"
            />
          </div>
          <AlbumDetail
            v-if="row.selectedAlbum"
            :album="row.selectedAlbum"
            :tracks="props.tracks"
            :selected-track-id="props.selectedTrackId"
            :current-track-id="props.currentTrackId"
            :tracks-loading="props.tracksLoading"
            :tracks-error="props.tracksError"
            :playlists="props.playlists"
            :playlists-loading="props.playlistsLoading"
            :playlists-error="props.playlistsError"
            :track-action-pending="props.trackActionPending"
            @close="closeAlbum(row.selectedAlbum)"
            @select-track="emit('selectTrack', $event)"
            @play-track="emit('playTrack', $event)"
            @play-album="emit('playAlbum')"
            @refresh-playlists="emit('refreshPlaylists')"
            @add-to-next="emit('addToNext', $event)"
            @add-to-queue-end="emit('addToQueueEnd', $event)"
            @add-track-to-playlist="addTrackToPlaylist"
            @delete-track="emit('deleteTrack', $event)"
          />
        </template>
      </div>
    </template>
    <p v-else class="text-spotify-muted px-5 py-6 text-sm sm:px-8">请选择专辑演出者。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useClickFocus } from "@/ui/useClickFocus";
import type { LibraryAlbumSelection } from "@/library/selection";
import type { AlbumArtistSummary } from "@/types/artist";
import type { AlbumSummary } from "@/types/album";
import type { Playlist } from "@/types/playlist";
import type { TrackSummary } from "@/types/track";
import AlbumDetail from "@/library/ui/AlbumDetail.vue";
import AlbumCard from "@/library/ui/AlbumCard.vue";

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
  selectedTrackId: number | null;
  currentTrackId: number | null;
  albumsLoading: boolean;
  albumsError: string;
  tracksLoading: boolean;
  tracksError: string;
  playlists: Playlist[];
  playlistsLoading: boolean;
  playlistsError: string;
  trackActionPending: boolean;
  trackActionError: string;
}>();

const emit = defineEmits<{
  selectAlbum: [album: AlbumSummary | null];
  selectTrack: [trackId: number];
  playTrack: [trackId: number];
  playAlbum: [];
  refreshPlaylists: [];
  addToNext: [trackId: number];
  addToQueueEnd: [trackId: number];
  addTrackToPlaylist: [trackId: number, playlistId: number];
  deleteTrack: [trackId: number];
}>();

const columnCount = ref(2);
const { focusedItem, setFocusedItem } = useClickFocus();

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

function getAlbumFocusKey(album: AlbumSummary) {
  return `album:${getAlbumKey(album)}`;
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
  setFocusedItem(getAlbumFocusKey(album));
  emit("selectAlbum", isSelectedAlbum(album) ? null : album);
}

function closeAlbum(album: AlbumSummary) {
  setFocusedItem(getAlbumFocusKey(album));
  emit("selectAlbum", null);
}

function addTrackToPlaylist(trackId: number, playlistId: number) {
  emit("addTrackToPlaylist", trackId, playlistId);
}
</script>

<template>
  <section
    v-if="props.artist"
    aria-labelledby="album-browser-heading"
    class="sidebar-scrollbars bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto text-white"
  >
    <header class="shrink-0 px-5 py-6 sm:px-8 sm:py-8">
      <h1 id="album-browser-heading" class="text-3xl font-bold tracking-tight sm:text-4xl">
        {{ props.artist.name }}
      </h1>
    </header>

    <div class="flex flex-col gap-6 px-5 pb-8 sm:px-8">
      <template v-for="row in albumRows" :key="row.id">
        <div class="grid grid-cols-2 gap-x-4 sm:grid-cols-3 sm:gap-x-6 xl:grid-cols-4">
          <Album
            v-for="(album, index) in row.albums"
            :key="album.id"
            :album="album"
            :cover-index="row.startIndex + index"
            :is-selected="props.selectedAlbumId === album.id"
            :is-focused="focusedItem === getAlbumFocusKey(album.id)"
            @select="toggleAlbum(album)"
          />
        </div>
        <AlbumDetail
          v-if="row.selectedAlbum"
          :album="row.selectedAlbum"
          @close="closeAlbum(row.selectedAlbum)"
        />
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useClickFocus } from "../../composables/useClickFocus";
import type { Album as AlbumData } from "../../types/album";
import type { Track } from "../../types/track";
import type { Artist } from "../../types/artist";
import AlbumDetail from "./AlbumDetail.vue";
import Album from "./Album.vue";

type ArtistSelection = Artist | null;

type AlbumBrowserRow = {
  id: string;
  startIndex: number;
  albums: AlbumData[];
  selectedAlbum: AlbumData | null;
};

const SMALL_SCREEN_BREAKPOINT = 640;
const WIDE_SCREEN_BREAKPOINT = 1280;

const props = defineProps<{
  artist: ArtistSelection;
  selectedAlbumId: string | null;
}>();

const emit = defineEmits<{
  "update:selectedAlbumId": [albumId: string | null];
}>();

const columnCount = ref(2);
const { focusedItem, setFocusedItem } = useClickFocus();

const albums = computed(() => (props.artist ? createPlaceholderAlbums(props.artist) : []));
const albumRows = computed(() => {
  const rows: AlbumBrowserRow[] = [];

  for (let startIndex = 0; startIndex < albums.value.length; startIndex += columnCount.value) {
    const rowAlbums = albums.value.slice(startIndex, startIndex + columnCount.value);
    const firstAlbum = rowAlbums[0];
    if (!firstAlbum) continue;

    rows.push({
      id: firstAlbum.id,
      startIndex,
      albums: rowAlbums,
      selectedAlbum: rowAlbums.find((album) => album.id === props.selectedAlbumId) ?? null,
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

function getAlbumFocusKey(id: string) {
  return `album:${id}`;
}

function toggleAlbum(album: AlbumData) {
  setFocusedItem(getAlbumFocusKey(album.id));
  emit("update:selectedAlbumId", props.selectedAlbumId === album.id ? null : album.id);
}

function closeAlbum(album: AlbumData) {
  setFocusedItem(getAlbumFocusKey(album.id));
  emit("update:selectedAlbumId", null);
}

function createPlaceholderAlbums(artist: Artist): AlbumData[] {
  return Array.from({ length: artist.albumCount }, (_, albumIndex) => {
    const albumNumber = albumIndex + 1;

    return {
      id: `${artist.name}:${albumNumber}`,
      title: `专辑 ${String(albumNumber).padStart(2, "0")}`,
      artist: artist.name,
      year: 2025 - Math.floor(albumIndex / 3),
      tracks: createPlaceholderTracks(artist.name, albumNumber, albumIndex),
    };
  });
}

function createPlaceholderTracks(
  artistName: string,
  albumNumber: number,
  albumIndex: number,
): Track[] {
  const trackCount = 10 + (albumIndex % 5);

  return Array.from({ length: trackCount }, (_, trackIndex) => {
    const minutes = 2 + ((albumIndex + trackIndex) % 4);
    const seconds = 35 + ((albumIndex * 11 + trackIndex * 7) % 25);

    return {
      id: `${artistName}:${albumNumber}:track:${trackIndex + 1}`,
      title: `曲目 ${String(trackIndex + 1).padStart(2, "0")}`,
      duration: `${minutes}:${String(seconds).padStart(2, "0")}`,
    };
  });
}
</script>

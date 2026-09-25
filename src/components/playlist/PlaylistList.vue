<template>
  <section
    aria-label="播放列表浏览"
    class="bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col text-white"
  >
    <h2 class="shrink-0 px-2 py-1 text-sm font-medium text-white/90">播放列表浏览</h2>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <ul class="space-y-0.5">
        <PlaylistListItem
          v-for="playlist in props.playlists"
          :key="playlist.id"
          :name="playlist.name"
          :is-focused="focusedItem === getPlaylistFocusKey(playlist.id)"
          :is-selected="props.selectedPlaylistId === playlist.id"
          @select="selectPlaylist(playlist)"
        />
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useClickFocus } from "../../composables/useClickFocus";
import type { Playlist } from "../../types/playlist";
import PlaylistListItem from "./PlaylistListItem.vue";

const props = defineProps<{
  playlists: Playlist[];
  selectedPlaylistId: string | null;
}>();

const emit = defineEmits<{
  select: [playlist: Playlist];
}>();

const { focusedItem, setFocusedItem } = useClickFocus();

function getPlaylistFocusKey(id: string) {
  return `playlist:${id}`;
}

function selectPlaylist(playlist: Playlist) {
  setFocusedItem(getPlaylistFocusKey(playlist.id));
  emit("select", playlist);
}
</script>

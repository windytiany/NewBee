<template>
  <section
    aria-label="播放列表浏览"
    class="bg-spotify-base flex h-full min-h-0 w-full min-w-0 flex-col text-white"
  >
    <header class="flex shrink-0 items-center justify-between gap-2 px-2 py-1">
      <h2 class="text-sm font-medium text-white/90">播放列表浏览</h2>
      <button
        class="focus-visible:outline-spotify-green shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2"
        type="button"
        @click="emit('create')"
      >
        新建歌单
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <p v-if="props.isLoading" class="text-spotify-muted px-2 py-3 text-sm" role="status">
        正在读取歌单…
      </p>
      <p v-if="props.error" class="px-2 py-3 text-sm text-red-300" role="alert">
        {{ props.error }}
      </p>
      <p
        v-if="!props.isLoading && !props.error && props.playlists.length === 0"
        class="text-spotify-muted px-2 py-3 text-sm"
      >
        还没有歌单。
      </p>
      <ul v-if="props.playlists.length > 0" class="space-y-0.5">
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
import { useClickFocus } from "@/ui/useClickFocus";
import type { Playlist } from "@/types/playlist";
import PlaylistListItem from "@/playlist/ui/PlaylistListItem.vue";

const props = defineProps<{
  playlists: Playlist[];
  selectedPlaylistId: number | null;
  isLoading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  select: [playlist: Playlist];
  create: [];
}>();

const { focusedItem, setFocusedItem } = useClickFocus();

function getPlaylistFocusKey(id: number) {
  return `playlist:${id}`;
}

function selectPlaylist(playlist: Playlist) {
  setFocusedItem(getPlaylistFocusKey(playlist.id));
  emit("select", playlist);
}
</script>

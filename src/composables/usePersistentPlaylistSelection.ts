import { computed, ref, watch } from "vue";
import type { Playlist } from "../types/playlist.ts";

const STORAGE_KEY = "newbee.playlist-selection";

function loadSelectedPlaylistId(availablePlaylists: Playlist[]): string | null {
  try {
    const storedPlaylistId = globalThis.localStorage.getItem(STORAGE_KEY);
    if (storedPlaylistId === null) return null;

    if (availablePlaylists.some(({ id }) => id === storedPlaylistId)) return storedPlaylistId;

    return null;
  } catch (error) {
    console.error("Could not read the saved playlist selection; using an empty selection.", error);
    return null;
  }
}

function saveSelectedPlaylistId(playlistId: string | null) {
  try {
    if (playlistId === null) {
      globalThis.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    globalThis.localStorage.setItem(STORAGE_KEY, playlistId);
  } catch (error) {
    globalThis.console.error("Could not save the playlist selection.", error);
  }
}

export function usePersistentPlaylistSelection(availablePlaylists: Playlist[]) {
  const selectedPlaylistId = ref(loadSelectedPlaylistId(availablePlaylists));
  const selectedPlaylist = computed(
    () => availablePlaylists.find(({ id }) => id === selectedPlaylistId.value) ?? null,
  );

  watch(selectedPlaylistId, saveSelectedPlaylistId, { flush: "sync", immediate: true });

  function selectPlaylist(playlist: Playlist) {
    selectedPlaylistId.value = playlist.id;
  }

  return { selectedPlaylistId, selectedPlaylist, selectPlaylist };
}

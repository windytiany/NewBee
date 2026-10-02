import { computed, ref, watch } from "vue";
import type { PlaylistSummary } from "@/playlist/model";

const STORAGE_KEY = "newbee.playlist-selection";

function loadSelectedPlaylistId(availablePlaylists: PlaylistSummary[]): number | null {
  try {
    const storedPlaylistId = globalThis.localStorage.getItem(STORAGE_KEY);
    if (storedPlaylistId === null || !/^\d+$/.test(storedPlaylistId)) return null;

    const playlistId = Number(storedPlaylistId);
    if (!Number.isSafeInteger(playlistId) || playlistId <= 0) return null;

    return availablePlaylists.some(({ id }) => id === playlistId) ? playlistId : null;
  } catch (error) {
    console.error("Could not read the saved playlist selection; using an empty selection.", error);
    return null;
  }
}

function saveSelectedPlaylistId(playlistId: number | null) {
  try {
    if (playlistId === null) {
      globalThis.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    globalThis.localStorage.setItem(STORAGE_KEY, String(playlistId));
  } catch (error) {
    globalThis.console.error("Could not save the playlist selection.", error);
  }
}

export function usePersistentPlaylistSelection() {
  const availablePlaylists = ref<PlaylistSummary[]>([]);
  const selectedPlaylistId = ref<number | null>(null);
  let hasLoadedPlaylists = false;

  const selectedPlaylist = computed(
    () => availablePlaylists.value.find(({ id }) => id === selectedPlaylistId.value) ?? null,
  );

  watch(
    selectedPlaylistId,
    (playlistId) => {
      if (hasLoadedPlaylists) saveSelectedPlaylistId(playlistId);
    },
    { flush: "sync" },
  );

  function setAvailablePlaylists(playlists: PlaylistSummary[]) {
    availablePlaylists.value = playlists;

    if (!hasLoadedPlaylists) {
      hasLoadedPlaylists = true;
      selectedPlaylistId.value = loadSelectedPlaylistId(playlists);
      saveSelectedPlaylistId(selectedPlaylistId.value);
      return;
    }

    if (
      selectedPlaylistId.value !== null &&
      !playlists.some(({ id }) => id === selectedPlaylistId.value)
    ) {
      selectedPlaylistId.value = null;
    }
  }

  function selectPlaylist(playlist: PlaylistSummary) {
    if (!availablePlaylists.value.some(({ id }) => id === playlist.id)) return;
    selectedPlaylistId.value = playlist.id;
  }

  return {
    availablePlaylists,
    selectedPlaylistId,
    selectedPlaylist,
    setAvailablePlaylists,
    selectPlaylist,
  };
}

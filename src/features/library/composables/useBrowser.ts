import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { Ref } from "vue";
import { useLibrarySelection } from "@/features/library/composables/useSelection";
import { useLibraryActions } from "@/features/library/composables/useActions";
import { createLibraryApi } from "@/features/library/api";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { AlbumArtistSummary, AlbumSummary, TrackSummary } from "@/features/library/types";

export function useLibraryBrowser(active: Readonly<Ref<boolean>>) {
  const artists = ref<AlbumArtistSummary[]>([]);
  const albums = ref<AlbumSummary[]>([]);
  const tracks = ref<TrackSummary[]>([]);
  const isLoadingArtists = ref(false);
  const isLoadingAlbums = ref(false);
  const isLoadingTracks = ref(false);
  const artistsError = ref("");
  const albumsError = ref("");
  const tracksError = ref("");
  const actions = useLibraryActions(tracks, isLoadingTracks, invoke);
  const api = createLibraryApi(invoke);
  const {
    selectedGroup,
    selectedAlbum,
    setAvailableGroups,
    setAvailableAlbums,
    selectGroup,
    selectAlbum: setSelectedAlbum,
  } = useLibrarySelection();

  let isMounted = false;
  let isSubscribedToLibraryChanges = false;
  let artistsRequestGeneration = 0;
  let albumsRequestGeneration = 0;
  let tracksRequestGeneration = 0;

  function sameGroup(left: AlbumArtistSummary | null, right: AlbumArtistSummary | null) {
    return left?.albumArtist === right?.albumArtist;
  }

  function sameAlbumSelection(
    left: { albumArtist: string | null; album: string | null } | null,
    right: { albumArtist: string | null; album: string | null } | null,
  ) {
    return left?.albumArtist === right?.albumArtist && left?.album === right?.album;
  }

  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === "string" ? error : "未知错误";
  }

  async function refreshLibrary() {
    if (!isMounted || !active.value) return;

    const generation = ++artistsRequestGeneration;
    ++albumsRequestGeneration;
    ++tracksRequestGeneration;
    isLoadingAlbums.value = false;
    isLoadingTracks.value = selectedAlbum.value !== null;
    albumsError.value = "";
    tracksError.value = "";
    isLoadingArtists.value = true;
    artistsError.value = "";

    try {
      const result = await api.listArtists();
      if (!isMounted || !active.value || generation !== artistsRequestGeneration) return;

      artists.value = result;
      setAvailableGroups(result);
      const group = selectedGroup.value;
      if (group) {
        void loadAlbums(group);
      } else {
        albums.value = [];
        tracks.value = [];
      }
    } catch (error) {
      if (!isMounted || !active.value || generation !== artistsRequestGeneration) return;
      artistsError.value = `读取专辑演出者失败：${errorMessage(error)}`;
      isLoadingTracks.value = false;
    } finally {
      if (isMounted && active.value && generation === artistsRequestGeneration) {
        isLoadingArtists.value = false;
      }
    }
  }

  async function loadAlbums(group: AlbumArtistSummary) {
    if (!isMounted || !active.value || !sameGroup(selectedGroup.value, group)) return;

    const generation = ++albumsRequestGeneration;
    ++tracksRequestGeneration;
    albums.value = [];
    tracks.value = [];
    isLoadingTracks.value = selectedAlbum.value !== null;
    tracksError.value = "";
    albumsError.value = "";
    isLoadingAlbums.value = true;

    try {
      const result = await api.listAlbums(group.albumArtist);
      if (
        !isMounted ||
        !active.value ||
        generation !== albumsRequestGeneration ||
        !sameGroup(selectedGroup.value, group)
      ) {
        return;
      }

      albums.value = result;
      setAvailableAlbums(group.albumArtist, result);
      const selection = selectedAlbum.value;
      if (selection && selection.albumArtist === group.albumArtist) {
        void loadTracks(selection);
      } else {
        isLoadingTracks.value = false;
      }
    } catch (error) {
      if (!isMounted || !active.value || generation !== albumsRequestGeneration) return;
      albumsError.value = `读取专辑失败：${errorMessage(error)}`;
      isLoadingTracks.value = false;
    } finally {
      if (isMounted && active.value && generation === albumsRequestGeneration) {
        isLoadingAlbums.value = false;
      }
    }
  }

  async function loadTracks(selection: { albumArtist: string | null; album: string | null }) {
    if (!isMounted || !active.value || !sameAlbumSelection(selectedAlbum.value, selection)) return;

    const generation = ++tracksRequestGeneration;
    tracks.value = [];
    tracksError.value = "";
    isLoadingTracks.value = true;

    try {
      const result = await api.listAlbumTracks(selection);
      if (
        !isMounted ||
        !active.value ||
        generation !== tracksRequestGeneration ||
        !sameAlbumSelection(selectedAlbum.value, selection)
      ) {
        return;
      }

      tracks.value = result;
    } catch (error) {
      if (
        !isMounted ||
        !active.value ||
        generation !== tracksRequestGeneration ||
        !sameAlbumSelection(selectedAlbum.value, selection)
      ) {
        return;
      }
      tracksError.value = `读取曲目失败：${errorMessage(error)}`;
    } finally {
      if (isMounted && active.value && generation === tracksRequestGeneration) {
        isLoadingTracks.value = false;
      }
    }
  }

  function selectArtist(artist: AlbumArtistSummary) {
    selectGroup(artist);
    void loadAlbums(artist);
  }

  function selectAlbum(album: AlbumSummary | null) {
    setSelectedAlbum(album);
    ++tracksRequestGeneration;
    tracks.value = [];
    tracksError.value = "";
    isLoadingTracks.value = false;

    const selection = selectedAlbum.value;
    if (selection) void loadTracks(selection);
  }

  function onLibraryChanged() {
    void refreshLibrary();
  }

  function onSettingsChanged() {
    const group = selectedGroup.value;
    if (group) void loadAlbums(group);
  }

  function activate() {
    if (!isMounted || !active.value) return;

    if (!isSubscribedToLibraryChanges) {
      globalThis.window.addEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
      globalThis.window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
      isSubscribedToLibraryChanges = true;
    }
    void refreshLibrary();
  }

  function deactivate() {
    if (isSubscribedToLibraryChanges) {
      globalThis.window.removeEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
      globalThis.window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
      isSubscribedToLibraryChanges = false;
    }

    ++artistsRequestGeneration;
    ++albumsRequestGeneration;
    ++tracksRequestGeneration;
    isLoadingArtists.value = false;
    isLoadingAlbums.value = false;
    isLoadingTracks.value = false;
  }

  watch(
    active,
    (isActive) => {
      if (!isMounted) return;
      if (isActive) activate();
      else deactivate();
    },
    { flush: "sync" },
  );

  onMounted(() => {
    isMounted = true;
    if (active.value) activate();
  });

  onUnmounted(() => {
    isMounted = false;
    deactivate();
  });

  return {
    ...actions,
    artists,
    albums,
    tracks,
    isLoadingArtists,
    isLoadingAlbums,
    isLoadingTracks,
    artistsError,
    albumsError,
    tracksError,
    selectedGroup,
    selectedAlbum,
    refreshLibrary,
    selectArtist,
    selectAlbum,
  };
}

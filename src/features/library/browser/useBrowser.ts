import { invoke } from "@tauri-apps/api/core";
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { Ref } from "vue";
import { useLibrarySelection } from "@/features/library/browser/useSelection";
import { useLibraryActions } from "@/features/library/useActions";
import { createLibraryApi } from "@/features/library/api";
import { TRACKS_CHANGED_EVENT } from "@/features/tracks/events";
import { LIBRARY_CHANGED_EVENT } from "@/features/library/events";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type {
  ArtistSummary,
  AlbumSummary,
  LibraryAlbumSelection,
  LibraryGrouping,
} from "@/features/library/types";
import type { TrackSummary } from "@/features/tracks/types";

export function useLibraryBrowser(active: Readonly<Ref<boolean>>) {
  const artists = ref<ArtistSummary[]>([]);
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
    grouping,
    setGrouping,
    selectedGroup,
    selectedAlbum,
    setAvailableGroups,
    setAvailableAlbums,
    selectGroup,
    selectAlbum: setSelectedAlbum,
  } = useLibrarySelection();

  let isMounted = false;
  let libraryNeedsRefresh = true;
  let artistsRequestGeneration = 0;
  let albumsRequestGeneration = 0;
  let tracksRequestGeneration = 0;

  function sameGroup(left: ArtistSummary | null, right: ArtistSummary | null) {
    return left !== null && right !== null && left.artist === right.artist;
  }

  function sameAlbumSelection(
    left: LibraryAlbumSelection | null,
    right: LibraryAlbumSelection | null,
  ) {
    return (
      left?.albumArtist === right?.albumArtist &&
      left?.album === right?.album &&
      left?.group?.grouping === right?.group?.grouping &&
      left?.group?.artist === right?.group?.artist
    );
  }

  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === "string" ? error : "未知错误";
  }

  async function refreshLibrary() {
    if (!isMounted || !active.value) return;

    libraryNeedsRefresh = false;
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
      const result = await api.listArtists(grouping.value);
      if (!isMounted || !active.value || generation !== artistsRequestGeneration) return;

      artists.value = result;
      setAvailableGroups(result);
      const group = selectedGroup.value;
      if (group) {
        void loadAlbums(group);
      } else {
        albums.value = [];
        tracks.value = [];
        isLoadingTracks.value = false;
      }
    } catch (error) {
      if (!isMounted || !active.value || generation !== artistsRequestGeneration) return;
      libraryNeedsRefresh = true;
      artistsError.value = `读取演出者失败：${errorMessage(error)}`;
      isLoadingTracks.value = false;
    } finally {
      if (isMounted && active.value && generation === artistsRequestGeneration) {
        isLoadingArtists.value = false;
      }
    }
  }

  async function loadAlbums(group: ArtistSummary) {
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
      const result = await api.listAlbums({ grouping: grouping.value, artist: group.artist });
      if (
        !isMounted ||
        !active.value ||
        generation !== albumsRequestGeneration ||
        !sameGroup(selectedGroup.value, group)
      ) {
        return;
      }

      albums.value = result;
      setAvailableAlbums(group.artist, result);
      const selection = selectedAlbum.value;
      if (selection) {
        void loadTracks(selection);
      } else {
        isLoadingTracks.value = false;
      }
    } catch (error) {
      if (!isMounted || !active.value || generation !== albumsRequestGeneration) return;
      libraryNeedsRefresh = true;
      albumsError.value = `读取专辑失败：${errorMessage(error)}`;
      isLoadingTracks.value = false;
    } finally {
      if (isMounted && active.value && generation === albumsRequestGeneration) {
        isLoadingAlbums.value = false;
      }
    }
  }

  async function loadTracks(selection: LibraryAlbumSelection) {
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
      libraryNeedsRefresh = true;
      tracksError.value = `读取曲目失败：${errorMessage(error)}`;
    } finally {
      if (isMounted && active.value && generation === tracksRequestGeneration) {
        isLoadingTracks.value = false;
      }
    }
  }

  function selectGrouping(next: LibraryGrouping) {
    if (next === grouping.value) return;
    deactivate();
    setGrouping(next);
    artists.value = [];
    albums.value = [];
    tracks.value = [];
    artistsError.value = "";
    albumsError.value = "";
    tracksError.value = "";
    libraryNeedsRefresh = true;
    void refreshLibrary();
  }

  function selectArtist(artist: ArtistSummary) {
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
    libraryNeedsRefresh = true;
    void refreshLibrary();
  }

  function onSettingsChanged() {
    if (!active.value) {
      libraryNeedsRefresh = true;
      return;
    }
    const group = selectedGroup.value;
    if (group) void loadAlbums(group);
  }

  function activate() {
    if (!isMounted || !active.value || !libraryNeedsRefresh) return;
    void refreshLibrary();
  }

  function deactivate() {
    if (isLoadingArtists.value || isLoadingAlbums.value || isLoadingTracks.value) {
      libraryNeedsRefresh = true;
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
    globalThis.window.addEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
    globalThis.window.addEventListener(TRACKS_CHANGED_EVENT, onLibraryChanged);
    globalThis.window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
    if (active.value) activate();
  });

  onUnmounted(() => {
    isMounted = false;
    globalThis.window.removeEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
    globalThis.window.removeEventListener(TRACKS_CHANGED_EVENT, onLibraryChanged);
    globalThis.window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
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
    grouping,
    selectGrouping,
    selectedGroup,
    selectedAlbum,
    refreshLibrary,
    selectArtist,
    selectAlbum,
  };
}

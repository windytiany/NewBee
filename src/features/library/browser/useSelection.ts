import { logger } from "@/shared/logging/logger";
import { ref } from "vue";
import type {
  AlbumArtistSummary,
  AlbumSummary,
  LibraryAlbumSelection,
} from "@/features/library/types";

interface StoredLibrarySelection {
  groupSelected: boolean;
  albumArtist: string | null;
  albumSelected: boolean;
  album: string | null;
}

const STORAGE_KEY = "newbee.library-selection";
const EMPTY_SELECTION: StoredLibrarySelection = {
  groupSelected: false,
  albumArtist: null,
  albumSelected: false,
  album: null,
};

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function loadLibrarySelection(): StoredLibrarySelection {
  try {
    const serializedSelection = globalThis.localStorage.getItem(STORAGE_KEY);
    if (serializedSelection === null) return { ...EMPTY_SELECTION };

    const parsedSelection: unknown = JSON.parse(serializedSelection);
    if (
      typeof parsedSelection !== "object" ||
      parsedSelection === null ||
      Array.isArray(parsedSelection)
    ) {
      throw new Error("Saved library selection has an invalid format.");
    }

    const selection = parsedSelection as Record<string, unknown>;
    if (
      typeof selection.groupSelected !== "boolean" ||
      typeof selection.albumSelected !== "boolean" ||
      !isNullableString(selection.albumArtist) ||
      !isNullableString(selection.album) ||
      (!selection.groupSelected && (selection.albumArtist !== null || selection.albumSelected)) ||
      (!selection.albumSelected && selection.album !== null)
    ) {
      throw new Error("Saved library selection has invalid values.");
    }

    return {
      groupSelected: selection.groupSelected,
      albumArtist: selection.albumArtist,
      albumSelected: selection.albumSelected,
      album: selection.album,
    };
  } catch (error) {
    logger.warn(
      "features/library/browser/useSelection",
      "Could not read the saved library selection; using an empty selection.",
      error,
    );
    return { ...EMPTY_SELECTION };
  }
}

export function useLibrarySelection() {
  const storedSelection = loadLibrarySelection();
  const selectedGroup = ref<AlbumArtistSummary | null>(null);
  const selectedAlbum = ref<LibraryAlbumSelection | null>(null);
  let pendingAlbumSelection: LibraryAlbumSelection | null = null;
  let hasRestoredGroups = false;

  function saveSelection() {
    const group = selectedGroup.value;
    const album = selectedAlbum.value;
    const selection: StoredLibrarySelection = {
      groupSelected: group !== null,
      albumArtist: group?.albumArtist ?? null,
      albumSelected: album !== null,
      album: album?.album ?? null,
    };

    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    } catch (error) {
      logger.warn(
        "features/library/browser/useSelection",
        "Could not save the library selection.",
        error,
      );
    }
  }

  function setAvailableGroups(groups: AlbumArtistSummary[]) {
    if (!hasRestoredGroups) {
      hasRestoredGroups = true;
      if (storedSelection.groupSelected) {
        const group = groups.find(
          (available) => available.albumArtist === storedSelection.albumArtist,
        );
        if (group) {
          selectedGroup.value = group;
          if (storedSelection.albumSelected) {
            pendingAlbumSelection = {
              albumArtist: storedSelection.albumArtist,
              album: storedSelection.album,
            };
            return;
          }
        }
      }

      selectedAlbum.value = null;
      saveSelection();
      return;
    }

    if (!selectedGroup.value) return;

    const group = groups.find(
      (available) => available.albumArtist === selectedGroup.value?.albumArtist,
    );
    if (!group) {
      selectedGroup.value = null;
      selectedAlbum.value = null;
      pendingAlbumSelection = null;
      saveSelection();
      return;
    }

    selectedGroup.value = group;
  }

  function setAvailableAlbums(albumArtist: string | null, albums: AlbumSummary[]) {
    if (selectedGroup.value?.albumArtist !== albumArtist) return;

    if (pendingAlbumSelection) {
      const pending = pendingAlbumSelection;
      pendingAlbumSelection = null;
      const album = albums.find((available) => available.album === pending.album);
      selectedAlbum.value = album ? { albumArtist: pending.albumArtist, album: album.album } : null;
      saveSelection();
      return;
    }

    const currentSelection = selectedAlbum.value;
    if (currentSelection) {
      const album =
        currentSelection.albumArtist === albumArtist
          ? albums.find((available) => available.album === currentSelection.album)
          : undefined;
      selectedAlbum.value = album ? { albumArtist, album: album.album } : null;
    }
    saveSelection();
  }

  function selectGroup(group: AlbumArtistSummary) {
    const isSameGroup = selectedGroup.value?.albumArtist === group.albumArtist;
    if (!isSameGroup) {
      selectedAlbum.value = null;
      pendingAlbumSelection = null;
    }
    selectedGroup.value = group;
    if (!pendingAlbumSelection) saveSelection();
  }

  function selectAlbum(album: AlbumSummary | null) {
    const group = selectedGroup.value;
    if (album && !group) return;

    selectedAlbum.value =
      album && group ? { albumArtist: group.albumArtist, album: album.album } : null;
    pendingAlbumSelection = null;
    saveSelection();
  }

  return {
    selectedGroup,
    selectedAlbum,
    setAvailableGroups,
    setAvailableAlbums,
    selectGroup,
    selectAlbum,
  };
}

import { logger } from "@/shared/logging/logger";
import { ref } from "vue";
import type {
  ArtistSummary,
  AlbumSummary,
  LibraryAlbumSelection,
  LibraryGrouping,
} from "@/features/library/types";

interface StoredSelection {
  group: { artist: string | null } | null;
  album: { albumArtist: string | null; album: string | null } | null;
}

interface StoredLibrarySelection {
  grouping: LibraryGrouping;
  selections: Record<LibraryGrouping, StoredSelection>;
}

const STORAGE_KEY = "newbee.library-selection";

function emptySelection(): StoredLibrarySelection {
  return {
    grouping: "albumArtist",
    selections: {
      albumArtist: { group: null, album: null },
      artist: { group: null, album: null },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseSelection(value: unknown): StoredSelection {
  if (!isRecord(value)) throw new Error("Saved library selection has invalid values.");
  const group = value.group;
  const album = value.album;
  const selection: StoredSelection = { group: null, album: null };
  if (group !== null) {
    if (!isRecord(group) || !isNullableString(group.artist)) {
      throw new Error("Saved library group has invalid values.");
    }
    selection.group = { artist: group.artist };
  }
  if (album !== null) {
    if (
      !isRecord(album) ||
      !isNullableString(album.albumArtist) ||
      !isNullableString(album.album)
    ) {
      throw new Error("Saved library album has invalid values.");
    }
    if (group === null) throw new Error("Saved library album has no group.");
    selection.album = { albumArtist: album.albumArtist, album: album.album };
  }
  return selection;
}

function loadLibrarySelection(): StoredLibrarySelection {
  try {
    const serialized = globalThis.localStorage.getItem(STORAGE_KEY);
    if (serialized === null) return emptySelection();
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      (value.grouping !== "albumArtist" && value.grouping !== "artist") ||
      !isRecord(value.selections)
    ) {
      throw new Error("Saved library selection has an invalid format.");
    }
    return {
      grouping: value.grouping,
      selections: {
        albumArtist: parseSelection(value.selections.albumArtist),
        artist: parseSelection(value.selections.artist),
      },
    };
  } catch (error) {
    logger.warn(
      "features/library/browser/useSelection",
      "Could not read the saved library selection; using an empty selection.",
      error,
    );
    return emptySelection();
  }
}

export function useLibrarySelection() {
  const stored = loadLibrarySelection();
  const grouping = ref<LibraryGrouping>(stored.grouping);
  const selectedGroup = ref<ArtistSummary | null>(null);
  const selectedAlbum = ref<LibraryAlbumSelection | null>(null);
  let pendingAlbumSelection: StoredSelection["album"] = null;
  let hasRestoredGroups = false;

  function persist() {
    stored.grouping = grouping.value;
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch (error) {
      logger.warn(
        "features/library/browser/useSelection",
        "Could not save the library selection.",
        error,
      );
    }
  }

  function saveSelection() {
    const album = selectedAlbum.value;
    stored.selections[grouping.value] = {
      group: selectedGroup.value ? { artist: selectedGroup.value.artist } : null,
      album: album ? { albumArtist: album.albumArtist, album: album.album } : pendingAlbumSelection,
    };
    persist();
  }

  function setGrouping(next: LibraryGrouping) {
    if (next === grouping.value) return;
    if (hasRestoredGroups) saveSelection();
    grouping.value = next;
    selectedGroup.value = null;
    selectedAlbum.value = null;
    pendingAlbumSelection = null;
    hasRestoredGroups = false;
    persist();
  }

  function setAvailableGroups(groups: ArtistSummary[]) {
    if (!hasRestoredGroups) {
      hasRestoredGroups = true;
      const previous = stored.selections[grouping.value];
      selectedGroup.value = previous.group
        ? (groups.find((group) => group.artist === previous.group?.artist) ?? null)
        : null;
      pendingAlbumSelection = selectedGroup.value ? previous.album : null;
      if (!pendingAlbumSelection) saveSelection();
      return;
    }
    if (!selectedGroup.value) return;
    selectedGroup.value =
      groups.find((group) => group.artist === selectedGroup.value?.artist) ?? null;
    if (!selectedGroup.value) {
      selectedAlbum.value = null;
      pendingAlbumSelection = null;
      saveSelection();
    }
  }

  function albumSelection(album: {
    albumArtist: string | null;
    album: string | null;
  }): LibraryAlbumSelection {
    return {
      albumArtist: album.albumArtist,
      album: album.album,
      ...(grouping.value === "artist"
        ? { group: { grouping: grouping.value, artist: selectedGroup.value?.artist ?? null } }
        : {}),
    };
  }

  function setAvailableAlbums(artist: string | null, albums: AlbumSummary[]) {
    if (!selectedGroup.value || selectedGroup.value.artist !== artist) return;
    const selection = pendingAlbumSelection ?? selectedAlbum.value;
    pendingAlbumSelection = null;
    const album = selection
      ? albums.find(
          (available) =>
            available.albumArtist === selection.albumArtist && available.album === selection.album,
        )
      : null;
    selectedAlbum.value = album ? albumSelection(album) : null;
    saveSelection();
  }

  function selectGroup(group: ArtistSummary) {
    if (!selectedGroup.value || selectedGroup.value.artist !== group.artist) {
      selectedAlbum.value = null;
      pendingAlbumSelection = null;
    }
    selectedGroup.value = group;
    if (!pendingAlbumSelection) saveSelection();
  }

  function selectAlbum(album: AlbumSummary | null) {
    if (album && !selectedGroup.value) return;
    selectedAlbum.value = album ? albumSelection(album) : null;
    pendingAlbumSelection = null;
    saveSelection();
  }

  return {
    grouping,
    selectedGroup,
    selectedAlbum,
    setGrouping,
    setAvailableGroups,
    setAvailableAlbums,
    selectGroup,
    selectAlbum,
  };
}

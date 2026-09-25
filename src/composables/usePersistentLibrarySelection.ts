import { ref, watch } from "vue";
import type { Artist } from "../types/artist";
import { libraryArtists } from "../components/library/libraryArtists";

interface LibrarySelection {
  artist: Artist | null;
  albumId: string | null;
}

const STORAGE_KEY = "newbee.library-selection";
const EMPTY_SELECTION: LibrarySelection = {
  artist: null,
  albumId: null,
};

function readStoredAlbumId(value: unknown, artist: Artist): string | null {
  if (typeof value !== "string") return null;

  const prefix = `${artist.name}:`;
  if (!value.startsWith(prefix)) return null;

  const albumNumberText = value.slice(prefix.length);
  const albumNumber = Number(albumNumberText);
  if (
    !Number.isInteger(albumNumber) ||
    albumNumber < 1 ||
    albumNumber > artist.albumCount ||
    String(albumNumber) !== albumNumberText
  ) {
    return null;
  }

  return value;
}

function loadLibrarySelection(): LibrarySelection {
  try {
    const serializedSelection = globalThis.localStorage.getItem(STORAGE_KEY);
    if (serializedSelection === null) return { ...EMPTY_SELECTION };

    const parsedSelection: unknown = JSON.parse(serializedSelection);
    if (
      typeof parsedSelection !== "object" ||
      parsedSelection === null ||
      Array.isArray(parsedSelection)
    ) {
      console.error("Saved library selection has an invalid format; using an empty selection.");
      return { ...EMPTY_SELECTION };
    }

    const selection = parsedSelection as Record<string, unknown>;
    if (selection.artistName === null) return { ...EMPTY_SELECTION };
    if (typeof selection.artistName !== "string") {
      console.error("Saved library artist is invalid; using an empty selection.");
      return { ...EMPTY_SELECTION };
    }

    const artist = libraryArtists.find(({ name }) => name === selection.artistName);
    if (!artist) {
      console.error("Saved library artist is no longer available; using an empty selection.");
      return { ...EMPTY_SELECTION };
    }

    return {
      artist,
      albumId: readStoredAlbumId(selection.albumId, artist),
    };
  } catch (error) {
    console.error("Could not read the saved library selection; using an empty selection.", error);
    return { ...EMPTY_SELECTION };
  }
}

function saveLibrarySelection(artist: Artist | null, albumId: string | null) {
  try {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        artistName: artist?.name ?? null,
        albumId,
      }),
    );
  } catch (error) {
    globalThis.console.error("Could not save the library selection.", error);
  }
}

const initialSelection = loadLibrarySelection();
const selectedArtist = ref<Artist | null>(initialSelection.artist);
const selectedAlbumId = ref<string | null>(initialSelection.albumId);

watch(
  [selectedArtist, selectedAlbumId],
  ([artist, albumId]) => saveLibrarySelection(artist, albumId),
  { flush: "sync" },
);

export function usePersistentLibrarySelection() {
  function selectArtist(artist: Artist) {
    if (selectedArtist.value?.name !== artist.name) selectedAlbumId.value = null;
    selectedArtist.value = artist;
  }

  return { selectedArtist, selectedAlbumId, selectArtist };
}

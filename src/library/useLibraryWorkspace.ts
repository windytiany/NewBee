import { nextTick, reactive, ref, markRaw } from "vue";
import type { Ref } from "vue";
import { useLibraryPage } from "@/library/usePage";
import type { LibraryAlbumSelection } from "@/library/selection";
import { useNotification } from "@/notification/useNotification";
import type { Playlist } from "@/types/playlist";
import type { TrackSummary } from "@/types/track";

type DeletionDialog = { show: () => void; close: () => void };

type LibraryWorkspaceOptions = {
  playlists: {
    readonly playlists: readonly Playlist[];
    readonly isLoadingPlaylists: boolean;
    readonly playlistsError: string;
  };
  refreshPlaylists: () => Promise<void>;
};

export function useLibraryWorkspace(
  active: Readonly<Ref<boolean>>,
  options: LibraryWorkspaceOptions,
) {
  const page = useLibraryPage(active);
  const deleteAlbumDialog = ref<DeletionDialog | null>(null);
  const deleteTrackDialog = ref<DeletionDialog | null>(null);
  const deleteAlbumTarget = ref<LibraryAlbumSelection | null>(null);
  const deleteTrackTarget = ref<TrackSummary | null>(null);

  for (const [key, source] of [
    ["library-artists", page.artistsError],
    ["library-albums", page.albumsError],
    ["library-tracks", page.tracksError],
  ] as const) {
    useNotification(() => (source.value ? { type: "error", message: source.value, key } : null));
  }
  useNotification(() => {
    if (page.isTrackActionPending.value) return null;
    const message = [page.trackActionMessage.value, page.trackActionError.value]
      .filter(Boolean)
      .join("\n");
    if (!message) return null;
    let type = page.trackActionMessageType.value as "success" | "warning" | "error";
    if (page.trackActionError.value) type = page.trackActionMessage.value ? "warning" : "error";
    return { type, message, key: type === "success" ? undefined : "library-action" };
  });

  async function addTracksToExistingPlaylist(trackIds: number[], playlistId: number) {
    const result = await page.addTracksToPlaylist(trackIds, playlistId);
    if (result.successfulTrackIds.length > 0) await options.refreshPlaylists();
  }

  async function addAlbumToExistingPlaylist(album: LibraryAlbumSelection, playlistId: number) {
    const result = await page.addAlbumToPlaylist(album, playlistId);
    if (result.successfulTrackIds.length > 0) await options.refreshPlaylists();
  }

  function requestAlbumDeletion(album: LibraryAlbumSelection) {
    if (page.isTrackActionPending.value) return;
    deleteAlbumTarget.value = album;
    void nextTick(() => deleteAlbumDialog.value?.show());
  }

  function cancelAlbumDeletion() {
    deleteAlbumTarget.value = null;
  }

  async function confirmAlbumDeletion(album: LibraryAlbumSelection) {
    if (deleteAlbumTarget.value !== album) return;
    const result = await page.removeAlbumFromLibrary(album);
    if (!result.completed) return;
    deleteAlbumDialog.value?.close();
    cancelAlbumDeletion();
  }

  function requestTrackDeletion(trackId: number) {
    const track = page.tracks.value.find((entry) => entry.id === trackId);
    if (!track) return;
    deleteTrackTarget.value = track;
    void nextTick(() => deleteTrackDialog.value?.show());
  }

  function cancelTrackDeletion() {
    deleteTrackTarget.value = null;
  }

  async function confirmTrackDeletion(trackId: number) {
    if (deleteTrackTarget.value?.id !== trackId) return;
    const result = await page.removeTrackFromLibrary(trackId);
    if (result.status === "not-deleted") return;
    deleteTrackDialog.value?.close();
    deleteTrackTarget.value = null;
  }

  return reactive({
    page,
    playlists: options.playlists,
    elements: markRaw({ deleteAlbumDialog, deleteTrackDialog }),
    deleteAlbumTarget,
    deleteTrackTarget,
    refreshPlaylists: options.refreshPlaylists,
    addTracksToExistingPlaylist,
    addAlbumToExistingPlaylist,
    requestAlbumDeletion,
    cancelAlbumDeletion,
    confirmAlbumDeletion,
    requestTrackDeletion,
    cancelTrackDeletion,
    confirmTrackDeletion,
  });
}

export type LibraryWorkspace = ReturnType<typeof useLibraryWorkspace>;

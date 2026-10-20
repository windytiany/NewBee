import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { nextTick, reactive, ref, markRaw } from "vue";
import type { Ref } from "vue";
import { useLibraryBrowser } from "@/features/library/browser/useBrowser";
import type { LibraryAlbumSelection } from "@/features/library/types";
import type { TrackSummary } from "@/features/tracks/types";
import { useNotification } from "@/shared/notifications/useNotification";
import type { PlaylistSummary } from "@/features/playlist/types";

type DeletionDialog = { show: () => void; close: () => void };

type LibraryOptions = {
  playlists: {
    readonly playlists: readonly PlaylistSummary[];
    readonly isLoadingPlaylists: boolean;
    readonly playlistsError: string;
  };
  refreshPlaylists: () => Promise<void>;
};

export function useLibrary(active: Readonly<Ref<boolean>>, options: LibraryOptions) {
  const page = useLibraryBrowser(active);
  const deleteAlbumDialog = ref<DeletionDialog | null>(null);
  const deleteTrackDialog = ref<DeletionDialog | null>(null);
  const deleteAlbumTarget = ref<LibraryAlbumSelection | null>(null);
  const deleteTrackTarget = ref<TrackSummary | null>(null);

  for (const [key, source] of [
    ["library-artists", page.artistsError],
    ["library-albums", page.albumsError],
    ["library-tracks", page.tracksError],
  ] as const) {
    useNotification(() => {
      const message = source.value;
      if (!message) return null;
      logger.error("library", key, message);
      return { type: "error", message: t("读取曲库失败"), key };
    });
  }
  useNotification(() => {
    if (page.isTrackActionPending.value) return null;
    const message = [page.trackActionMessage.value, page.trackActionError.value]
      .filter(Boolean)
      .join("\n");
    if (!message) return null;
    let type = page.trackActionMessageType.value as "success" | "warning" | "error";
    if (page.trackActionError.value) type = page.trackActionMessage.value ? "warning" : "error";
    if (page.trackActionError.value)
      logger.warn("library", "action_failed", page.trackActionError.value);
    const removal = page.trackActionRemoval.value;
    const inconsistent = Boolean(
      removal && removal.deletedCount > 0 && (removal.failedCount > 0 || removal.queueSyncFailed),
    );
    if (inconsistent) type = "warning";
    else if (removal && removal.failedCount > 0) type = "error";
    return {
      type,
      message: page.trackActionError.value
        ? inconsistent
          ? removal?.failedCount
            ? removal?.queueSyncFailed
              ? t("已从曲库移除 {count} 首，{failed} 首移除失败，队列同步失败", {
                  count: removal?.deletedCount ?? 0,
                  failed: removal?.failedCount ?? 0,
                })
              : t("已从曲库移除 {count} 首，{failed} 首移除失败", {
                  count: removal?.deletedCount ?? 0,
                  failed: removal?.failedCount ?? 0,
                })
            : removal?.queueSyncFailed
              ? t("已从曲库移除 {count} 首，队列同步失败", {
                  count: removal?.deletedCount ?? 0,
                })
              : t("已从曲库移除 {count} 首", { count: removal?.deletedCount ?? 0 })
          : removal
            ? t("曲库移除失败")
            : page.trackActionMessage.value || t("曲库操作失败")
        : message,
      persistent: inconsistent,
      key: type === "success" ? undefined : "library-action",
    };
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
    page.trackActionError.value = "";
    page.trackActionMessage.value = "";
    page.trackActionRemoval.value = null;
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
    page.trackActionError.value = "";
    page.trackActionMessage.value = "";
    page.trackActionRemoval.value = null;
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

export type LibraryState = ReturnType<typeof useLibrary>;

import { computed, nextTick, ref, watch } from "vue";
import type { Ref } from "vue";
import { t } from "@/shared/i18n/locale";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import type { usePlaylistState } from "@/features/playlist/usePlaylistState";

type PlaylistManagementDialog = "rename" | "delete";
type ManagementDialog = { show: () => void; close: () => void };
type PlaylistListFocus = {
  focusPlaylist: (playlistId: number) => Promise<void>;
  focusAfterDeletion: (originalIndex: number) => Promise<void>;
};

type PlaylistManagementState = Pick<
  ReturnType<typeof usePlaylistState>,
  "playlists" | "pendingPlaylistIds" | "renamePlaylist" | "deletePlaylist"
>;

export function usePlaylistManagement(
  active: Readonly<Ref<boolean>>,
  page: PlaylistManagementState,
) {
  const playlistList = ref<PlaylistListFocus | null>(null);
  const renamePlaylistDialog = ref<ManagementDialog | null>(null);
  const deletePlaylistDialog = ref<ManagementDialog | null>(null);
  const managementPlaylistId = ref<number | null>(null);
  const managementDialogType = ref<PlaylistManagementDialog | null>(null);
  const managementOriginalIndex = ref<number | null>(null);
  const managementPlaylist = computed(() => {
    const playlistId = managementPlaylistId.value;
    return playlistId === null
      ? null
      : (page.playlists.value.find((playlist) => playlist.id === playlistId) ?? null);
  });
  const managementPlaylistPending = computed(() => {
    const playlistId = managementPlaylistId.value;
    return playlistId !== null && page.pendingPlaylistIds.value.includes(playlistId);
  });
  let playlistManagementRequestSequence = 0;
  let activePlaylistManagementRequestId = 0;

  function closePlaylistManagementDialog() {
    if (managementDialogType.value === "rename") renamePlaylistDialog.value?.close();
    if (managementDialogType.value === "delete") deletePlaylistDialog.value?.close();
  }

  function resetPlaylistManagement() {
    closePlaylistManagementDialog();
    activePlaylistManagementRequestId = ++playlistManagementRequestSequence;
    managementPlaylistId.value = null;
    managementDialogType.value = null;
    managementOriginalIndex.value = null;
  }

  function isCurrentPlaylistManagementRequest(
    playlistId: number,
    dialogType: PlaylistManagementDialog,
    requestId: number,
  ) {
    return (
      activePlaylistManagementRequestId === requestId &&
      managementPlaylistId.value === playlistId &&
      managementDialogType.value === dialogType &&
      active.value
    );
  }

  function requestPlaylistManagement(dialogType: PlaylistManagementDialog, playlistId: number) {
    if (!active.value) return;
    const originalIndex = page.playlists.value.findIndex((playlist) => playlist.id === playlistId);
    if (originalIndex < 0 || page.pendingPlaylistIds.value.includes(playlistId)) return;

    const requestId = ++playlistManagementRequestSequence;
    activePlaylistManagementRequestId = requestId;
    managementPlaylistId.value = playlistId;
    managementDialogType.value = dialogType;
    managementOriginalIndex.value = originalIndex;

    void nextTick(() => {
      if (!isCurrentPlaylistManagementRequest(playlistId, dialogType, requestId)) return;
      if (page.pendingPlaylistIds.value.includes(playlistId)) {
        cancelPlaylistManagement();
        return;
      }
      if (dialogType === "rename") renamePlaylistDialog.value?.show();
      else deletePlaylistDialog.value?.show();
    });
  }

  function requestPlaylistRename(playlistId: number) {
    requestPlaylistManagement("rename", playlistId);
  }

  function requestPlaylistDeletion(playlistId: number) {
    requestPlaylistManagement("delete", playlistId);
  }

  async function focusAfterPlaylistDeletion(originalIndex: number) {
    await nextTick();
    if (!active.value) return;
    await playlistList.value?.focusAfterDeletion(originalIndex);
  }

  async function restorePlaylistManagementFocus(playlistId: number, originalIndex: number) {
    await nextTick();
    if (!active.value) return;
    if (page.playlists.value.some((playlist) => playlist.id === playlistId)) {
      await playlistList.value?.focusPlaylist(playlistId);
    } else {
      await playlistList.value?.focusAfterDeletion(originalIndex);
    }
  }

  function cancelPlaylistManagement() {
    const playlistId = managementPlaylistId.value;
    const originalIndex = managementOriginalIndex.value;
    resetPlaylistManagement();
    if (playlistId !== null && originalIndex !== null) {
      void restorePlaylistManagementFocus(playlistId, originalIndex);
    }
  }

  async function confirmPlaylistRename(playlistId: number, name: string) {
    if (
      !isCurrentPlaylistManagementRequest(playlistId, "rename", activePlaylistManagementRequestId)
    )
      return;
    if (page.pendingPlaylistIds.value.includes(playlistId)) return;

    const requestId = ++playlistManagementRequestSequence;
    activePlaylistManagementRequestId = requestId;
    const originalIndex = managementOriginalIndex.value ?? 0;
    const result = await page.renamePlaylist(playlistId, name);
    if (result.status === "error") {
      logger.error("playlist", "rename_failed", result.message, { playlistId });
      notify({
        type: "error",
        message: t("重命名歌单失败"),
        key: "playlist-management",
      });
      return;
    }
    if (!isCurrentPlaylistManagementRequest(playlistId, "rename", requestId)) return;
    resetPlaylistManagement();
    void restorePlaylistManagementFocus(playlistId, originalIndex);
  }

  async function confirmPlaylistDeletion(playlistId: number) {
    if (
      !isCurrentPlaylistManagementRequest(playlistId, "delete", activePlaylistManagementRequestId)
    )
      return;
    if (page.pendingPlaylistIds.value.includes(playlistId)) return;
    const originalIndex = managementOriginalIndex.value;
    if (originalIndex === null) return;

    const requestId = ++playlistManagementRequestSequence;
    activePlaylistManagementRequestId = requestId;
    const result = await page.deletePlaylist(playlistId);
    if (result.status === "error") {
      logger.error("playlist", "delete_failed", result.message, { playlistId });
      notify({ type: "error", message: t("删除歌单失败"), key: "playlist-management" });
      return;
    }
    if (!isCurrentPlaylistManagementRequest(playlistId, "delete", requestId)) return;
    resetPlaylistManagement();
    await focusAfterPlaylistDeletion(originalIndex);
  }

  watch(managementPlaylist, (playlist) => {
    if (playlist || managementPlaylistId.value === null) return;
    const originalIndex = managementOriginalIndex.value;
    resetPlaylistManagement();
    if (originalIndex !== null) void focusAfterPlaylistDeletion(originalIndex);
  });

  watch(active, (isActive) => {
    if (!isActive && managementPlaylistId.value !== null) resetPlaylistManagement();
  });

  return {
    playlistList,
    renamePlaylistDialog,
    deletePlaylistDialog,
    managementPlaylist,
    managementDialogType,
    managementPlaylistPending,
    requestPlaylistRename,
    requestPlaylistDeletion,
    cancelPlaylistManagement,
    confirmPlaylistRename,
    confirmPlaylistDeletion,
  };
}

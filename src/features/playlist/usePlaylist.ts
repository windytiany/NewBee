import { t } from "@/shared/i18n/locale";
import { markRaw, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type { Ref } from "vue";
import { logger } from "@/shared/logging/logger";
import { useNotification } from "@/shared/notifications/useNotification";
import { usePlaylistState, type PlaylistAvailability } from "@/features/playlist/usePlaylistState";
import { usePlaylistManagement } from "@/features/playlist/management/useManagement";
import { TRACKS_CHANGED_EVENT, type TracksChange } from "@/features/tracks/events";
import { PLAYLIST_CHANGED_EVENT } from "@/features/playlist/events";
import { usePlaybackSession } from "@/features/playback/session";

export function usePlaylist(active: Readonly<Ref<boolean>>) {
  const availability = ref<PlaylistAvailability>("unavailable");
  const page = usePlaylistState(availability);

  function onTracksChanged(event: Event) {
    page.updateTrackMetadata((event as CustomEvent<TracksChange>).detail);
  }

  function onPlaylistChanged() {
    void page.refreshPlaylists();
  }

  watch(
    active,
    (isActive) => {
      if (availability.value === "unavailable") return;
      availability.value = isActive ? "active" : "background";
    },
    { flush: "sync" },
  );

  onMounted(() => {
    globalThis.window.addEventListener(TRACKS_CHANGED_EVENT, onTracksChanged);
    globalThis.window.addEventListener(PLAYLIST_CHANGED_EVENT, onPlaylistChanged);
    availability.value = active.value ? "active" : "background";
  });

  onBeforeUnmount(() => {
    availability.value = "unavailable";
    globalThis.window.removeEventListener(TRACKS_CHANGED_EVENT, onTracksChanged);
    globalThis.window.removeEventListener(PLAYLIST_CHANGED_EVENT, onPlaylistChanged);
  });

  const { activeQueueRowKey } = usePlaybackSession().state;
  const createPlaylistDialog = ref<{ show: () => void } | null>(null);
  const management = usePlaylistManagement(active, page);
  for (const [key, source] of [
    ["playlist-list", page.playlistsError],
    ["playlist-tracks", page.playlistTracksError],
    ["playlist-metadata", page.trackMetadataError],
  ] as const) {
    useNotification(() => {
      const message = source.value;
      if (!message) return null;
      logger.error("playlist", key, message);
      return { type: "error", message: t("读取歌单失败"), key };
    });
  }

  useNotification(() => {
    const message = page.playlistActionError.value;
    if (!message) return null;
    logger.error("playlist", "action_failed", message);
    return { type: "error", message: t("歌单操作失败"), key: "playlist-action" };
  });

  function showCreatePlaylistDialog() {
    createPlaylistDialog.value?.show();
  }

  function onPlaylistCreated(playlistId: number) {
    void page.refreshPlaylists(playlistId);
  }

  return reactive({
    page,
    activeQueueRowKey,
    elements: markRaw({
      createPlaylistDialog,
      playlistList: management.playlistList,
      renamePlaylistDialog: management.renamePlaylistDialog,
      deletePlaylistDialog: management.deletePlaylistDialog,
    }),
    showCreatePlaylistDialog,
    managementPlaylist: management.managementPlaylist,
    managementDialogType: management.managementDialogType,
    managementPlaylistPending: management.managementPlaylistPending,
    requestPlaylistRename: management.requestPlaylistRename,
    requestPlaylistDeletion: management.requestPlaylistDeletion,
    cancelPlaylistManagement: management.cancelPlaylistManagement,
    confirmPlaylistRename: management.confirmPlaylistRename,
    confirmPlaylistDeletion: management.confirmPlaylistDeletion,
    onPlaylistCreated,
  });
}

export type PlaylistState = ReturnType<typeof usePlaylist>;

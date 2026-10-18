import { computed, onMounted, onUnmounted, ref } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useLibraryFileImport } from "@/features/library/import/useFileImport";
import { useLibraryScan } from "@/features/library/import/useScan";
import { useInboxImport } from "@/features/inbox/import";
import { resolveDropRegion, type DropRegion, type DropTarget } from "@/features/import/target";
import { createTrackRegistration } from "@/features/tracks/registration";
import { createTrackSynchronization } from "@/features/tracks/synchronize";
import { createPlaylistApi } from "@/features/playlist/api";
import { createDirectoryPlaylists } from "@/features/playlist/creation/directory";
import { createPlaylistAppend } from "@/features/playlist/tracks/append";
import { usePlaybackSession } from "@/features/playback/session";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { t } from "@/shared/i18n/locale";

export function useDropImport() {
  const library = useLibraryFileImport();
  const inbox = useInboxImport();
  const { isScanning } = useLibraryScan();
  const session = usePlaybackSession();
  const synchronization = createTrackSynchronization(session, invoke);
  const register = createTrackRegistration(invoke);
  const playlistApi = createPlaylistApi(invoke);
  const appendPlaylist = createPlaylistAppend(playlistApi);
  const importDirectories = createDirectoryPlaylists(playlistApi, (playlistId, paths) =>
    appendLocal(paths, { kind: "playlist", playlistId }),
  );
  const pending = ref(false);
  watchActivity(pending);
  const hasFiles = ref(false);
  const hasDirectories = ref(false);
  const modalOpen = ref(false);
  const region = ref<DropRegion | null>(null);
  const busy = computed(
    () => pending.value || library.isImporting.value || inbox.pending.value || isScanning.value,
  );
  const highlight = computed(() => {
    if (!region.value || modalOpen.value || busy.value) return null;
    if (!hasDirectories.value && (region.value.target.kind === "playlists" || !hasFiles.value))
      return null;
    const { left, top, width, height } = region.value.bounds;
    return { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` };
  });
  let scaleFactor = 0;
  let generation = 0;
  let disposed = false;
  const subscriptions: UnlistenFn[] = [];
  let observer: InstanceType<typeof globalThis.MutationObserver> | undefined;

  function updateModal() {
    modalOpen.value = !!globalThis.document.querySelector("dialog[open]");
  }
  function retain(stop: UnlistenFn) {
    if (disposed) stop();
    else subscriptions.push(stop);
  }
  async function appendLocal(
    paths: readonly string[],
    captured: Extract<DropTarget, { kind: "playlist" }> | { kind: "queue" },
  ) {
    const outcome = await register(
      paths,
      async (tracks) => {
        if (captured.kind === "playlist") {
          return appendPlaylist(
            captured.playlistId,
            tracks.map((track) => track.id),
          );
        } else {
          const applied = await session.addTracksToQueueEnd(
            tracks.map((track) => ({
              trackId: track.id,
              title: track.title,
              album: track.album,
              durationMs: track.durationMs,
            })),
          );
          if (!applied) throw new Error(t("添加到队尾失败"));
        }
      },
      synchronization.refresh,
    );
    const failed = outcome.results.filter((result) => result.status === "failed");
    if (failed.length) {
      logger.error("tracks", "registration_failed", failed);
      notify({ type: "warning", message: t("{count} 个文件登记失败", { count: failed.length }) });
    }
    if (outcome.appendError) {
      logger.error("import", "append_failed", outcome.appendError);
      const appended = outcome.appendResults;
      notify({
        type: "error",
        message: appended
          ? t("曲目已登记，已添加 {count} 首，{failed} 首追加失败", {
              count: appended.results.filter((result) => result.status === "added").length,
              failed: appended.results.filter((result) => result.status === "failed").length,
            })
          : t("曲目已登记，目标追加失败"),
      });
    }
    if (outcome.refreshError) {
      logger.error("tracks", "refresh_failed", outcome.refreshError);
      notify({ type: "warning", message: t("曲目信息刷新失败") });
    }
  }
  async function handleDrop(event: DragDropEvent) {
    updateModal();
    if (event.type === "leave") {
      ++generation;
      hasFiles.value = false;
      hasDirectories.value = false;
      region.value = null;
      return;
    }
    region.value = resolveDropRegion(event.position, scaleFactor, (x, y) =>
      globalThis.document.elementsFromPoint(x, y),
    );
    const captured = region.value?.target;
    if (event.type === "over") return;
    const current = ++generation;
    hasFiles.value = false;
    hasDirectories.value = false;
    if (modalOpen.value || (event.type === "drop" && !captured)) return;
    if (busy.value) {
      if (event.type === "drop")
        notify({ type: "info", message: t("操作进行中"), key: "drop-import-busy" });
      return;
    }
    if (event.type === "drop") {
      if (!captured || !event.paths.length) return;
      pending.value = true;
      try {
        if (captured.kind === "Library") await library.importPaths(event.paths);
        else if (captured.kind === "Inbox") await inbox.importPaths(event.paths);
        else if (captured.kind === "playlists") await importDirectories(event.paths);
        else await appendLocal(event.paths, captured);
      } catch (error) {
        logger.error("import", "drop_failed", error);
        notify({ type: "error", message: t("文件处理失败") });
      } finally {
        pending.value = false;
      }
      return;
    }
    try {
      const preview = await invoke<{ hasFiles: boolean; hasDirectories: boolean }>(
        "preview_local_drop",
        { paths: event.paths },
      );
      if (!disposed && generation === current) {
        hasFiles.value = preview.hasFiles;
        hasDirectories.value = preview.hasDirectories;
      }
    } catch (error) {
      logger.error("import", "drop_preview_failed", error);
    }
  }
  onMounted(async () => {
    if (!isTauri()) return;
    updateModal();
    observer = new globalThis.MutationObserver(updateModal);
    observer.observe(globalThis.document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    try {
      const window = getCurrentWindow();
      retain(
        await window.onScaleChanged(({ payload }) => {
          scaleFactor = payload.scaleFactor;
          region.value = null;
        }),
      );
      if (disposed) return;
      scaleFactor = await window.scaleFactor();
      if (disposed) return;
      retain(
        await getCurrentWebview().onDragDropEvent((event) => {
          if (!disposed) void handleDrop(event.payload);
        }),
      );
    } catch (error) {
      logger.error("import", "drop_listener_failed", error);
    }
  });
  onUnmounted(() => {
    disposed = true;
    ++generation;
    hasFiles.value = false;
    hasDirectories.value = false;
    region.value = null;
    observer?.disconnect();
    subscriptions.splice(0).forEach((stop) => stop());
  });
  return { highlight };
}

import { computed, onMounted, onUnmounted, ref, type Ref } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useLibraryFileImport } from "@/features/library/import/useFileImport";
import { useLibraryScan } from "@/features/library/import/useScan";
import { useInboxImport } from "@/features/inbox/import";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { t } from "@/shared/i18n/locale";

export function useDropImport(activePage: Ref<string>) {
  const library = useLibraryFileImport();
  const inbox = useInboxImport();
  const { isScanning } = useLibraryScan();
  const hasFiles = ref(false);
  const modalOpen = ref(false);
  const busy = computed(() => library.isImporting.value || inbox.pending.value || isScanning.value);
  const target = computed(() => {
    if (modalOpen.value || busy.value) return null;
    return activePage.value === "Library" || activePage.value === "Inbox" ? activePage.value : null;
  });
  const label = computed(() => {
    if (!hasFiles.value || !target.value) return "";
    return target.value === "Library" ? t("导入音乐库") : t("导入 Inbox");
  });
  let generation = 0;
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  let observer: InstanceType<typeof globalThis.MutationObserver> | undefined;

  function updateModal() {
    modalOpen.value = !!globalThis.document.querySelector("dialog[open]");
  }

  async function handleDrop(event: DragDropEvent) {
    updateModal();
    if (event.type === "over") return;
    const current = ++generation;
    hasFiles.value = false;
    if (event.type === "leave") return;
    if (modalOpen.value || (activePage.value !== "Library" && activePage.value !== "Inbox")) return;
    if (busy.value) {
      if (event.type === "drop")
        notify({ type: "info", message: t("导入进行中"), key: "drop-import-busy" });
      return;
    }
    if (event.type === "drop") {
      if (activePage.value === "Library") await library.importPaths(event.paths);
      else await inbox.importPaths(event.paths);
      return;
    }
    try {
      const paths = await invoke<string[]>("readable_audio_files", { paths: event.paths });
      if (!disposed && generation === current) hasFiles.value = paths.length > 0;
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
      const stop = await getCurrentWebview().onDragDropEvent((event) => {
        if (!disposed) void handleDrop(event.payload);
      });
      if (disposed) stop();
      else unlisten = stop;
    } catch (error) {
      logger.error("import", "drop_listener_failed", error);
    }
  });
  onUnmounted(() => {
    disposed = true;
    generation += 1;
    observer?.disconnect();
    unlisten?.();
  });
  return { label };
}

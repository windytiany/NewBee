import { computed, onMounted, onUnmounted, ref } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { resolveDropRegion, type DropRegion } from "@/app/import/target";
import { useImport } from "@/app/import/useImport";
import { logger } from "@/shared/logging/logger";

export function useDropImport() {
  const { importPaths } = useImport();
  const hasFiles = ref(false);
  const hasDirectories = ref(false);
  const modalOpen = ref(false);
  const region = ref<DropRegion | null>(null);
  const highlight = computed(() => {
    if (!region.value || modalOpen.value) return null;
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
    if (event.type === "drop") {
      if (!captured || !event.paths.length) return;
      await importPaths(event.paths, captured);
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

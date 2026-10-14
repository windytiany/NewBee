import { onMounted, onScopeDispose, ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { t } from "@/shared/i18n/locale";

export function usePictureDrop(
  enabled: () => boolean,
  dropped: () => void,
  failed: (error: unknown) => void,
) {
  const path = ref<string | null>(null);
  let disposed = false;
  let stop: (() => void) | undefined;
  onMounted(async () => {
    if (!isTauri()) return;
    try {
      const unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (disposed || !enabled() || payload.type !== "drop") return;
        if (payload.paths.length !== 1 || !payload.paths[0]) {
          failed(new Error(t("请选择一张图片")));
          return;
        }
        path.value = payload.paths[0];
        dropped();
      });
      if (disposed) unlisten();
      else stop = unlisten;
    } catch (error) {
      if (!disposed) failed(error);
    }
  });
  onScopeDispose(() => {
    disposed = true;
    stop?.();
  });
  return path;
}

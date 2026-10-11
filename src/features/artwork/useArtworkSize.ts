import { onScopeDispose, readonly, ref, watch } from "vue";
import type { Ref } from "vue";
import { selectArtworkSize } from "@/features/artwork/size";

/** No image request until the visible cover has an actual layout size. */
export function useArtworkSize(element: Ref<HTMLElement | null>) {
  const size = ref(0);
  let observer: ResizeObserver | null = null;
  let resolution: MediaQueryList | null = null;
  let width = 0;
  let height = 0;
  const update = () => {
    size.value =
      selectArtworkSize(Math.ceil(Math.max(width, height) * (globalThis.devicePixelRatio || 1))) ??
      0;
  };
  const observeResolution = () => {
    resolution?.removeEventListener("change", resolutionChanged);
    resolution =
      globalThis.matchMedia?.(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`) ?? null;
    resolution?.addEventListener("change", resolutionChanged);
  };
  function resolutionChanged() {
    update();
    observeResolution();
  }
  observeResolution();
  const stop = watch(
    element,
    (target) => {
      observer?.disconnect();
      observer = null;
      width = 0;
      height = 0;
      size.value = 0;
      if (!target) return;
      observer = new globalThis.ResizeObserver((entries) => {
        if (element.value !== target) return;
        const bounds = entries[0]?.contentRect;
        if (!bounds) return;
        width = bounds.width;
        height = bounds.height;
        update();
      });
      observer.observe(target);
    },
    { immediate: true, flush: "post" },
  );
  onScopeDispose(() => {
    stop();
    observer?.disconnect();
    resolution?.removeEventListener("change", resolutionChanged);
  });
  return readonly(size);
}

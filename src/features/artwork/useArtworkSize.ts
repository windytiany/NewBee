import { onScopeDispose, readonly, ref, watch } from "vue";
import type { Ref } from "vue";

/** No image request until the visible cover has an actual layout size. */
export function useArtworkSize(element: Ref<HTMLElement | null>) {
  const size = ref(0);
  let observer: ResizeObserver | null = null;
  const stop = watch(
    element,
    (target) => {
      observer?.disconnect();
      observer = null;
      if (!target) {
        size.value = 0;
        return;
      }
      observer = new globalThis.ResizeObserver((entries) => {
        if (element.value !== target) return;
        const bounds = entries[0]?.contentRect;
        if (!bounds) return;
        const pixels = Math.ceil(
          Math.max(bounds.width, bounds.height) * (globalThis.devicePixelRatio || 1),
        );
        size.value = Math.min(4096, Math.max(0, pixels));
      });
      observer.observe(target);
    },
    { immediate: true, flush: "post" },
  );
  onScopeDispose(() => {
    stop();
    observer?.disconnect();
  });
  return readonly(size);
}

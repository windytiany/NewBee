import { computed, ref, watch } from "vue";
import type { Ref } from "vue";
import { ALBUM_COLUMN_WIDTH } from "@/features/library/browser/albums/layout";
import { layoutDensity } from "@/features/settings/layout";
import { logger } from "@/shared/logging/logger";

const STORAGE_KEY = "newbee.library.statistics.width";
const DEFAULT_WIDTH = 240;

function loadWidth() {
  try {
    const stored = globalThis.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_WIDTH;
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
      throw new Error("Saved statistics width is invalid.");
    return value;
  } catch (error) {
    logger.warn("library/statistics", "Could not read the saved statistics width.", error);
    return DEFAULT_WIDTH;
  }
}

export function useWidth(element: Ref<HTMLElement | null>) {
  const preferredWidth = ref(loadWidth());
  const containerWidth = ref(0);
  const maxWidth = computed(() =>
    containerWidth.value > 0 ? containerWidth.value / 2 : DEFAULT_WIDTH,
  );
  const minWidth = computed(() =>
    Math.min(ALBUM_COLUMN_WIDTH[layoutDensity.value], maxWidth.value),
  );
  const clamp = (value: number) => Math.max(minWidth.value, Math.min(maxWidth.value, value));
  const width = computed(() => clamp(preferredWidth.value));

  watch(
    element,
    (pane, _, onCleanup) => {
      const container = pane?.parentElement;
      if (!container) return;
      const measure = () => {
        if (container.clientWidth > 0) containerWidth.value = container.clientWidth;
      };
      measure();
      if (typeof globalThis.ResizeObserver === "undefined") return;
      const observer = new globalThis.ResizeObserver(measure);
      observer.observe(container);
      onCleanup(() => observer.disconnect());
    },
    { flush: "post" },
  );

  function resize(value: number) {
    if (!Number.isFinite(value)) return;
    preferredWidth.value = clamp(value);
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferredWidth.value));
    } catch (error) {
      logger.warn("library/statistics", "Could not save the statistics width.", error);
    }
  }

  return { width, minWidth, maxWidth, resize };
}

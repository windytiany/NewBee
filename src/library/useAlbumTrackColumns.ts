import { onBeforeUnmount, onMounted, onUpdated, ref, watch } from "vue";
import type { Ref } from "vue";

export function calculateAlbumTrackColumns(
  availableWidth: number,
  requiredRowWidths: readonly number[],
  columnGap: number,
): 1 | 2 {
  if (availableWidth <= 0 || requiredRowWidths.length < 2) return 1;
  const columnWidth = (availableWidth - columnGap) / 2;
  return requiredRowWidths.every((width) => width <= columnWidth) ? 2 : 1;
}

export function useAlbumTrackColumns(listElement: Ref<HTMLElement | null>) {
  const columnCount = ref<1 | 2>(1);
  let resizeObserver: ResizeObserver | null = null;
  let scheduledHandle: number | null = null;

  function measureColumns() {
    scheduledHandle = null;
    const list = listElement.value;
    if (list === null) return;
    const requiredWidths = [...list.querySelectorAll<HTMLElement>("[data-album-track-row]")].map(
      (row) => {
        const label = row.querySelector<HTMLElement>("[data-album-track-label]");
        const content = row.querySelector<HTMLElement>("[data-album-track-content]");
        if (label === null || content === null) return row.getBoundingClientRect().width;
        return (
          row.getBoundingClientRect().width -
          label.getBoundingClientRect().width +
          content.getBoundingClientRect().width
        );
      },
    );
    const gap = Number.parseFloat(globalThis.getComputedStyle(list).columnGap) || 0;
    columnCount.value = calculateAlbumTrackColumns(list.clientWidth, requiredWidths, gap);
  }

  function scheduleMeasurement() {
    if (resizeObserver === null || scheduledHandle !== null) return;
    scheduledHandle = globalThis.requestAnimationFrame(measureColumns);
  }

  watch(
    listElement,
    (list, previous) => {
      if (previous !== null) resizeObserver?.unobserve(previous);
      if (list !== null) resizeObserver?.observe(list);
      scheduleMeasurement();
    },
    { flush: "post" },
  );

  onMounted(() => {
    resizeObserver = new globalThis.ResizeObserver(scheduleMeasurement);
    if (listElement.value !== null) resizeObserver.observe(listElement.value);
    scheduleMeasurement();
  });
  onUpdated(scheduleMeasurement);
  onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (scheduledHandle !== null) globalThis.cancelAnimationFrame(scheduledHandle);
  });

  return columnCount;
}

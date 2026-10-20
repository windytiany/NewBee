import { nextTick, onScopeDispose, watch } from "vue";
import type { Ref } from "vue";

type AlbumScrollOptions = {
  viewport: Readonly<Ref<HTMLElement | null>>;
  grid: Readonly<Ref<HTMLElement | null>>;
  selectedIndex: Readonly<Ref<number>>;
  columns: Readonly<Ref<number>>;
  albumCount: Readonly<Ref<number>>;
  loading: Readonly<Ref<boolean>>;
};

export function useAlbumScroll(options: AlbumScrollOptions) {
  let generation = 0;
  onScopeDispose(() => generation++);

  watch(
    [options.selectedIndex, options.columns, options.albumCount, options.loading],
    async () => {
      const request = ++generation;
      await nextTick();
      if (request !== generation || options.selectedIndex.value < 0) return;
      const viewport = options.viewport.value;
      const grid = options.grid.value;
      if (!viewport || !grid || !viewport.clientHeight) return;
      const cards = grid.querySelectorAll<HTMLElement>("button[data-album-card]");
      const rowIndex = Math.floor(options.selectedIndex.value / options.columns.value);
      const first = cards[0];
      const row = cards[rowIndex * options.columns.value];
      if (!first || !row) return;

      const top = Math.max(0, row.getBoundingClientRect().top - first.getBoundingClientRect().top);
      viewport.scrollTop = Math.max(
        0,
        Math.min(top, viewport.scrollHeight - viewport.clientHeight),
      );
    },
    { flush: "post" },
  );
}

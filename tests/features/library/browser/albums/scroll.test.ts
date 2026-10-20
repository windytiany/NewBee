import { afterEach, expect, it } from "bun:test";
import { effectScope, nextTick, ref, shallowRef } from "vue";
import { useAlbumScroll } from "../../../../../src/features/library/browser/albums/scroll";

const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
});

async function settle() {
  await nextTick();
  await nextTick();
  await nextTick();
}

function fixture(contentHeight = 1200) {
  const selectedIndex = ref(-1);
  const columns = ref(4);
  const albumCount = ref(12);
  const loading = ref(false);
  const viewport = {
    clientHeight: 600,
    scrollTop: 100,
    get scrollHeight() {
      return contentHeight;
    },
    getBoundingClientRect: () => ({ top: 80 }),
  };
  const grid = {
    getBoundingClientRect: () => ({ bottom: 80 + contentHeight - viewport.scrollTop }),
    querySelectorAll: () =>
      Array.from({ length: albumCount.value }, (_, index) => ({
        getBoundingClientRect: () => ({
          top: 80 + 12 + Math.floor(index / columns.value) * 216 - viewport.scrollTop,
        }),
      })),
  };
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => {
    useAlbumScroll({
      viewport: shallowRef(viewport as unknown as HTMLElement),
      grid: shallowRef(grid as unknown as HTMLElement),
      selectedIndex,
      columns,
      albumCount,
      loading,
    });
  });
  return {
    selectedIndex,
    columns,
    loading,
    viewport,
    setHeight: (height: number) => {
      contentHeight = height;
    },
  };
}

it("aligns the selected album row with the first row's unscrolled position", async () => {
  const page = fixture();
  for (const index of [5, 9, 0, 6]) {
    page.selectedIndex.value = index;
    await settle();
    expect(page.viewport.scrollTop).toBe(Math.floor(index / 4) * 216);
  }
});

it("uses the bottom limit for a last row that cannot fill the viewport", async () => {
  const page = fixture(800);
  page.selectedIndex.value = 10;
  await settle();
  expect(page.viewport.scrollTop).toBe(200);
});

it("also uses the bottom limit for non-final rows when the remaining content is short", async () => {
  const page = fixture(800);
  page.selectedIndex.value = 5;
  await settle();
  expect(page.viewport.scrollTop).toBe(200);
});

it("recomputes the bottom limit after replacement tracks finish loading", async () => {
  const page = fixture();
  page.loading.value = true;
  page.selectedIndex.value = 9;
  await settle();
  expect(page.viewport.scrollTop).toBe(432);
  page.setHeight(800);
  page.loading.value = false;
  await settle();
  expect(page.viewport.scrollTop).toBe(200);
});

it("discards obsolete positioning when selection changes rapidly or closes", async () => {
  const page = fixture(800);
  page.selectedIndex.value = 5;
  await nextTick();
  page.selectedIndex.value = 9;
  await settle();
  expect(page.viewport.scrollTop).toBe(200);
  page.selectedIndex.value = 5;
  page.selectedIndex.value = -1;
  await settle();
  expect(page.viewport.scrollTop).toBe(200);
});

it("realigns the selected row when responsive column count changes", async () => {
  const page = fixture(1800);
  page.selectedIndex.value = 5;
  await settle();
  page.columns.value = 2;
  await settle();
  expect(page.viewport.scrollTop).toBe(432);
});

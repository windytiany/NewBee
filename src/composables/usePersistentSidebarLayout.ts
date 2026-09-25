import { ref, watch } from "vue";

interface SidebarLayout {
  leftPaneWidth: number | null;
  rightPaneWidth: number | null;
  rightTopHeight: number | null;
}

const STORAGE_KEY = "newbee.sidebar-layout";
const EMPTY_LAYOUT = {
  leftPaneWidth: null,
  rightPaneWidth: null,
  rightTopHeight: null,
} satisfies SidebarLayout;

function readStoredNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function loadSidebarLayout(): SidebarLayout {
  try {
    const serializedLayout = globalThis.localStorage.getItem(STORAGE_KEY);
    if (serializedLayout === null) return { ...EMPTY_LAYOUT };

    const parsedLayout: unknown = JSON.parse(serializedLayout);
    if (typeof parsedLayout !== "object" || parsedLayout === null || Array.isArray(parsedLayout)) {
      console.error("Saved sidebar layout has an invalid format; using adaptive defaults.");
      return { ...EMPTY_LAYOUT };
    }

    const layout = parsedLayout as Record<string, unknown>;
    return {
      leftPaneWidth: readStoredNumber(layout.leftPaneWidth),
      rightPaneWidth: readStoredNumber(layout.rightPaneWidth),
      rightTopHeight: readStoredNumber(layout.rightTopHeight),
    };
  } catch (error) {
    console.error("Could not read the saved sidebar layout; using adaptive defaults.", error);
    return { ...EMPTY_LAYOUT };
  }
}

const initialLayout = loadSidebarLayout();
const leftPaneWidth = ref(initialLayout.leftPaneWidth);
const rightPaneWidth = ref(initialLayout.rightPaneWidth);
const rightTopHeight = ref(initialLayout.rightTopHeight);

function saveSidebarLayout() {
  try {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        leftPaneWidth: leftPaneWidth.value,
        rightPaneWidth: rightPaneWidth.value,
        rightTopHeight: rightTopHeight.value,
      }),
    );
  } catch (error) {
    console.error("Could not save the sidebar layout.", error);
  }
}

watch([leftPaneWidth, rightPaneWidth, rightTopHeight], saveSidebarLayout, { flush: "sync" });

export function usePersistentSidebarLayout() {
  return { leftPaneWidth, rightPaneWidth, rightTopHeight };
}

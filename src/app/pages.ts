import { ref, watch } from "vue";
export const pageNames = ["Playing", "Library", "Playlist"] as const;
export type PageName = (typeof pageNames)[number];

const STORAGE_KEY = "newbee.active-page";
const DEFAULT_PAGE: PageName = "Playing";

function isPageName(value: string | null): value is PageName {
  return pageNames.some((pageName) => pageName === value);
}

function loadActivePage(): PageName {
  try {
    const storedPageName = globalThis.localStorage.getItem(STORAGE_KEY);
    return isPageName(storedPageName) ? storedPageName : DEFAULT_PAGE;
  } catch (error) {
    globalThis.console.error("Could not read the saved active page; using Playing.", error);
    return DEFAULT_PAGE;
  }
}

function saveActivePage(pageName: PageName) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, pageName);
  } catch (error) {
    globalThis.console.error("Could not save the active page.", error);
  }
}

export function usePersistentActivePage() {
  const activePage = ref<PageName>(loadActivePage());
  watch(activePage, saveActivePage, { flush: "sync", immediate: true });

  return { activePage };
}

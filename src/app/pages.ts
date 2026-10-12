import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { ref, watch } from "vue";
export const pageNames = ["Playing", "Library", "Playlist", "Inbox"] as const;
export type PageName = (typeof pageNames)[number];

export function pageLabel(page: PageName): string {
  const sources = { Playing: "正在播放", Library: "音乐库", Playlist: "播放列表", Inbox: "Inbox" };
  return t(sources[page]);
}

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
    logger.warn("app/pages", "Could not read the saved active page; using Playing.", error);
    return DEFAULT_PAGE;
  }
}

function saveActivePage(pageName: PageName) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, pageName);
  } catch (error) {
    logger.warn("app/pages", "Could not save the active page.", error);
  }
}

export function usePersistentActivePage() {
  const activePage = ref<PageName>(loadActivePage());
  watch(activePage, saveActivePage, { flush: "sync", immediate: true });

  return { activePage };
}

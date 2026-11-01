import { t } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { computed, readonly, ref, watch } from "vue";
export const pageNames = ["Playing", "Library", "Playlist", "Inbox"] as const;
export type PageName = (typeof pageNames)[number];

export function pageLabel(page: PageName): string {
  const sources = { Playing: "正在播放", Library: "音乐库", Playlist: "播放列表", Inbox: "Inbox" };
  return t(sources[page]);
}

const STORAGE_KEY = "newbee.active-page";
const DEFAULT_PAGE: PageName = "Library";

export type PageSetting = { name: PageName; enabled: boolean };
const configuredPages = ref<PageSetting[]>(pageNames.map((name) => ({ name, enabled: true })));
export const pageSettings = readonly(configuredPages);
export const visiblePages = computed(() =>
  configuredPages.value.filter((page) => page.enabled).map((page) => page.name),
);

export function applyPageSettings(pages?: readonly PageSetting[]) {
  const seen = new Set<PageName>();
  const normalized: PageSetting[] = [];
  for (const page of pages ?? []) {
    if (!isPageName(page.name) || seen.has(page.name)) continue;
    seen.add(page.name);
    normalized.push({ name: page.name, enabled: page.name === "Library" || page.enabled });
  }
  for (const name of pageNames) {
    if (!seen.has(name)) normalized.push({ name, enabled: true });
  }
  configuredPages.value = normalized;
}

function isPageName(value: string | null): value is PageName {
  return pageNames.some((pageName) => pageName === value);
}

function loadActivePage(): PageName {
  try {
    const storedPageName = globalThis.localStorage.getItem(STORAGE_KEY);
    return isPageName(storedPageName) ? storedPageName : DEFAULT_PAGE;
  } catch (error) {
    logger.warn("app/pages", "Could not read the saved active page; using Library.", error);
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
  const storedPage = ref<PageName>(loadActivePage());
  watch(
    visiblePages,
    (pages) => {
      if (!pages.includes(storedPage.value)) storedPage.value = pages[0] ?? "Library";
    },
    { flush: "sync", immediate: true },
  );
  watch(storedPage, saveActivePage, { flush: "sync", immediate: true });
  const activePage = computed({
    get: () => storedPage.value,
    set: (page: PageName) => {
      if (visiblePages.value.includes(page)) storedPage.value = page;
    },
  });

  return { activePage };
}

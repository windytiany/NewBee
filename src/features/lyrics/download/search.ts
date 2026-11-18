import { t } from "@/shared/i18n/locale";
import { reactive, watch } from "vue";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import type {
  LyricsCandidate,
  LyricsContent,
  LyricsProvider,
  LyricsSearchResults,
} from "@/features/lyrics/types";
import { contentMessage } from "@/features/lyrics/download/query";

export type LyricsSearchOptions = {
  search: (
    query: string,
    provider: LyricsProvider | null,
    offset: number,
  ) => Promise<LyricsSearchResults>;
  preview: (candidate: LyricsCandidate) => Promise<LyricsContent>;
  linked: (provider: LyricsProvider, link: string) => Promise<LyricsContent | null>;
  automatic: (trackId: number | string) => Promise<LyricsContent>;
  apply: (text: string) => void;
  mark: () => void;
};

export function createLyricsSearch(options: LyricsSearchOptions) {
  const state = reactive({
    query: "",
    provider: null as LyricsProvider | null,
    mode: "keyword" as "keyword" | "link",
    link: "",
    linkProvider: null as LyricsProvider | null,
    candidates: [] as LyricsCandidate[],
    nextOffset: null as number | null,
    selected: null as LyricsCandidate | null,
    preview: "",
    previewInstrumental: false,
    error: "",
    searching: false,
    previewing: false,
    automatic: false,
  });
  let searchGeneration = 0;
  let previewGeneration = 0;
  let automaticGeneration = 0;
  let searchedQuery = "";
  let searchedProvider: LyricsProvider | null = null;

  function report(message: string, event: string, reason?: unknown) {
    state.error = message;
    if (reason !== undefined) logger.warn("lyrics", event, reason);
    notify({ type: reason === undefined ? "info" : "warning", message });
  }

  function clearPreview() {
    previewGeneration++;
    state.previewing = false;
    state.selected = null;
    state.preview = "";
    state.previewInstrumental = false;
    state.error = "";
  }
  watch(
    [() => state.link, () => state.linkProvider],
    () => {
      if (state.mode === "link") clearPreview();
    },
    { flush: "sync" },
  );

  function setMode(mode: typeof state.mode) {
    if (mode === state.mode) return;
    searchGeneration++;
    state.searching = false;
    state.candidates = [];
    state.nextOffset = null;
    clearPreview();
    state.mode = mode;
  }
  function reset(query: string, linkProvider: LyricsProvider | null) {
    invalidate();
    Object.assign(state, {
      query,
      provider: null,
      mode: "keyword",
      link: "",
      linkProvider,
      candidates: [],
      nextOffset: null,
    });
    clearPreview();
  }
  function invalidate() {
    searchGeneration++;
    previewGeneration++;
    automaticGeneration++;
    state.searching = false;
    state.previewing = false;
    state.automatic = false;
  }
  async function request(
    query: string,
    provider: LyricsProvider | null,
    offset: number,
    previous: LyricsCandidate[],
  ) {
    const generation = ++searchGeneration;
    previewGeneration++;
    state.previewing = false;
    state.selected = null;
    state.preview = "";
    state.previewInstrumental = false;
    state.searching = true;
    state.error = "";
    state.candidates = previous;
    state.nextOffset = null;
    try {
      if (!query) {
        report(t("请输入搜索关键词。"), "search_query_missing");
        return;
      }
      const result = await options.search(query, provider, offset);
      if (generation !== searchGeneration) return;
      const combined = [...previous, ...result.candidates];
      const seen = new Set<string>();
      state.candidates = combined.filter((candidate) => {
        const key = `${candidate.provider}:${candidate.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      state.nextOffset = result.nextOffset;
      searchedQuery = query;
      searchedProvider = provider;
      if (!state.candidates.length) report(t("未找到候选曲目。"), "search_empty");
    } catch (error) {
      if (generation === searchGeneration) report(t("歌词搜索失败"), "search_failed", error);
    } finally {
      if (generation === searchGeneration) state.searching = false;
    }
  }
  function search() {
    return request(state.query.trim(), state.provider, 0, []);
  }
  function loadMore() {
    if (state.nextOffset === null || state.searching) return;
    return request(searchedQuery, searchedProvider, state.nextOffset, [...state.candidates]);
  }
  async function loadPreview(
    fetch: () => Promise<LyricsContent | null>,
    candidate: LyricsCandidate | null,
  ) {
    clearPreview();
    const generation = previewGeneration;
    state.selected = candidate;
    state.previewing = true;
    try {
      const content = await fetch();
      if (generation !== previewGeneration) return;
      if (content === null) state.error = t("请输入所选来源的有效单曲链接。");
      else if (content.kind === "available") state.preview = content.text;
      else if (candidate) {
        state.previewInstrumental = content.kind === "instrumental";
        report(contentMessage(content), "preview_unavailable");
      } else state.error = contentMessage(content);
    } catch (error) {
      if (generation !== previewGeneration) return;
      if (candidate) report(t("歌词预览失败"), "preview_failed", error);
      else {
        state.error = t("歌词获取失败");
        logger.warn("lyrics", "link_fetch_failed", error);
      }
    } finally {
      if (generation === previewGeneration) state.previewing = false;
    }
  }
  function select(candidate: LyricsCandidate) {
    return loadPreview(() => options.preview(candidate), candidate);
  }
  function fetchLink() {
    const { link, linkProvider } = state;
    if (state.mode !== "link" || !linkProvider || !link.trim() || state.previewing) return;
    return loadPreview(() => options.linked(linkProvider, link.trim()), null);
  }
  async function automatic(trackId: number | string) {
    const generation = ++automaticGeneration;
    state.automatic = true;
    state.error = "";
    try {
      const content = await options.automatic(trackId);
      if (generation !== automaticGeneration) return;
      if (content.kind === "available") options.apply(content.text);
      else {
        report(contentMessage(content), "automatic_unavailable");
        if (content.kind === "instrumental") options.mark();
      }
    } catch (error) {
      if (generation === automaticGeneration)
        report(t("自动获取歌词失败"), "automatic_failed", error);
    } finally {
      if (generation === automaticGeneration) state.automatic = false;
    }
  }
  function usePreview() {
    if (state.previewing) return;
    if (state.previewInstrumental) options.mark();
    else if (state.preview.trim()) options.apply(state.preview);
  }
  return {
    state,
    reset,
    invalidate,
    setMode,
    search,
    loadMore,
    select,
    fetchLink,
    automatic,
    usePreview,
  };
}

import { reactive } from "vue";
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
  automatic: (trackId: number) => Promise<LyricsContent>;
  apply: (text: string) => void;
  mark: () => void;
};

export function createLyricsSearch(options: LyricsSearchOptions) {
  const state = reactive({
    query: "",
    provider: null as LyricsProvider | null,
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

  function reset(query: string) {
    invalidate();
    Object.assign(state, {
      query,
      provider: null,
      candidates: [],
      nextOffset: null,
      selected: null,
      preview: "",
      previewInstrumental: false,
      error: "",
    });
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
      if (!query) throw new Error("请输入搜索关键词。");
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
      if (!state.candidates.length) state.error = "未找到候选曲目。";
    } catch (error) {
      if (generation === searchGeneration)
        state.error = String(error instanceof Error ? error.message : error);
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
  async function select(candidate: LyricsCandidate) {
    const generation = ++previewGeneration;
    state.selected = candidate;
    state.preview = "";
    state.previewInstrumental = false;
    state.previewing = true;
    state.error = "";
    try {
      const content = await options.preview(candidate);
      if (generation !== previewGeneration) return;
      if (content.kind === "available") state.preview = content.text;
      else {
        state.previewInstrumental = content.kind === "instrumental";
        state.error = contentMessage(content);
      }
    } catch (error) {
      if (generation === previewGeneration)
        state.error = String(error instanceof Error ? error.message : error);
    } finally {
      if (generation === previewGeneration) state.previewing = false;
    }
  }
  async function automatic(trackId: number) {
    const generation = ++automaticGeneration;
    state.automatic = true;
    state.error = "";
    try {
      const content = await options.automatic(trackId);
      if (generation !== automaticGeneration) return;
      if (content.kind === "available") options.apply(content.text);
      else {
        state.error = contentMessage(content);
        if (content.kind === "instrumental") options.mark();
      }
    } catch (error) {
      if (generation === automaticGeneration)
        state.error = String(error instanceof Error ? error.message : error);
    } finally {
      if (generation === automaticGeneration) state.automatic = false;
    }
  }
  function usePreview() {
    if (state.previewing) return;
    if (state.previewInstrumental) options.mark();
    else if (state.preview.trim()) options.apply(state.preview);
  }
  return { state, reset, invalidate, search, loadMore, select, automatic, usePreview };
}

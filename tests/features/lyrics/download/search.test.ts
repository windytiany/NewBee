import { afterEach, describe, expect, it } from "bun:test";
import { createLyricsSearch } from "@/features/lyrics/download/search";
import type { LyricsSearchOptions } from "@/features/lyrics/download/search";
import { searchQuery } from "@/features/lyrics/download/query";
import type { LyricsCandidate, LyricsContent, LyricsSearchResults } from "@/features/lyrics/types";

import { notifications } from "@/shared/notifications/center";

afterEach(() => notifications.clear());

const candidate: LyricsCandidate = {
  provider: "netease",
  id: 1,
  title: "Song",
  artists: ["Artist"],
  album: "Album",
  durationMs: 200_000,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides: Partial<LyricsSearchOptions> = {}) {
  const applied: string[] = [];
  let marked = 0;
  const search = createLyricsSearch({
    search: async () => ({ candidates: [candidate], nextOffset: null }),
    preview: async () => ({ kind: "available", text: "preview" }),
    automatic: async () => ({ kind: "available", text: "auto" }),
    apply: (text) => {
      applied.push(text);
    },
    mark: () => {
      marked++;
    },
    ...overrides,
  });
  return { search, applied, marked: () => marked };
}

describe("lyrics search", () => {
  it("reports failures once from the business request without changing draft data", async () => {
    const { search, applied } = setup({
      search: async () => {
        throw new Error("provider error");
      },
      preview: async () => {
        throw new Error("preview error");
      },
      automatic: async () => {
        throw new Error("automatic error");
      },
    });
    search.reset("query");
    await search.search();
    await search.select(candidate);
    await search.automatic(1);
    expect(notifications.items.value.map(({ message }) => message)).toEqual([
      "歌词搜索失败，请查看日志",
      "歌词预览失败，请查看日志",
      "自动获取歌词失败，请查看日志",
    ]);
    expect(applied).toEqual([]);
  });
  it("keeps empty search results as data and reports them once", async () => {
    const { search } = setup({ search: async () => ({ candidates: [], nextOffset: null }) });
    search.reset("query");
    await search.search();
    expect(search.state.candidates).toEqual([]);
    expect(notifications.items.value[0]?.message).toBe("未找到候选曲目。");
    expect(notifications.items.value[0]?.count).toBe(1);
  });
  it("uses local title and artist with a filename fallback, preserving version names", () => {
    expect(searchQuery({ title: "Song (Live)", artist: "Artist", path: "ignored.mp3" })).toBe(
      "Song (Live) Artist",
    );
    expect(searchQuery({ title: null, artist: null, path: "C:\\Music\\Artist - Song.flac" })).toBe(
      "Artist - Song",
    );
  });
  it("previews a candidate without applying it, then applies only when chosen", async () => {
    const { search, applied } = setup();
    search.reset("custom query");
    await search.search();
    await search.select(candidate);
    expect(search.state.preview).toBe("preview");
    expect(applied).toEqual([]);
    search.usePreview();
    expect(applied).toEqual(["preview"]);
  });
  it("allows arbitrary query/provider and loads more using the original search, deduplicating results", async () => {
    const calls: unknown[] = [];
    const { search } = setup({
      search: async (...args) => {
        calls.push(args);
        return {
          candidates: args[2] === 0 ? [candidate] : [candidate, { ...candidate, id: 2 }],
          nextOffset: args[2] === 0 ? 30 : null,
        };
      },
    });
    search.reset("wrong metadata corrected");
    search.state.provider = "netease";
    await search.search();
    search.state.query = "unsubmitted edits";
    search.state.provider = null;
    await search.loadMore();
    expect(calls).toEqual([
      ["wrong metadata corrected", "netease", 0],
      ["wrong metadata corrected", "netease", 30],
    ]);
    expect(search.state.candidates.map((entry) => entry.id)).toEqual([1, 2]);
  });
  it("ignores stale search and preview responses", async () => {
    const first = deferred<LyricsSearchResults>();
    const preview = deferred<LyricsContent>();
    let calls = 0;
    const { search } = setup({
      search: () =>
        ++calls === 1
          ? first.promise
          : Promise.resolve({ candidates: [{ ...candidate, id: 2 }], nextOffset: null }),
      preview: () => preview.promise,
    });
    search.reset("one");
    const old = search.search();
    search.state.query = "two";
    await search.search();
    first.resolve({ candidates: [candidate], nextOffset: null });
    await old;
    expect(search.state.candidates[0]?.id).toBe(2);
    const loading = search.select(candidate);
    search.invalidate();
    preview.resolve({ kind: "available", text: "late" });
    await loading;
    expect(search.state.preview).toBe("");
  });
  it("auto-fetch updates only the draft callback and ignores results after close", async () => {
    const result = deferred<LyricsContent>();
    const { search, applied } = setup({ automatic: () => result.promise });
    const loading = search.automatic(1);
    search.invalidate();
    result.resolve({ kind: "available", text: "late" });
    await loading;
    expect(applied).toEqual([]);
    await search.automatic(1);
    expect(applied).toEqual(["late"]);
  });
  it("marks explicit instrumental results but does not change the draft for missing lyrics", async () => {
    const { search, applied, marked } = setup({
      automatic: async () => ({ kind: "instrumental" }),
      preview: async () => ({ kind: "missing" }),
    });
    await search.automatic(1);
    expect(search.state.error).toContain("纯音乐");
    expect(marked()).toBe(1);
    await search.select(candidate);
    search.usePreview();
    expect(search.state.error).toContain("未找到");
    expect(applied).toEqual([]);
  });
});

import { describe, expect, it, mock } from "bun:test";
import { createLyricsSearch } from "@/features/lyrics/download/search";
import type { LyricsContent } from "@/features/lyrics/types";

describe("lyrics link preview", () => {
  it("does not let an old request restore lyrics after the song link changes", async () => {
    const old = Promise.withResolvers<LyricsContent>();
    const applied = mock((text: string) => text);
    const search = createLyricsSearch({
      search: async () => ({ candidates: [], nextOffset: null }),
      preview: async () => ({ kind: "missing" }),
      linked: (_, link) =>
        link.endsWith("id=1") ? old.promise : Promise.resolve({ kind: "available", text: "New" }),
      automatic: async () => ({ kind: "missing" }),
      apply: applied,
      mark: () => {},
    });
    search.reset("Track", "netease");
    search.setMode("link");
    search.state.link = "https://music.163.com/song?id=1";
    const pending = search.fetchLink();
    search.state.link = "https://music.163.com/song?id=2";
    search.usePreview();
    expect(applied).not.toHaveBeenCalled();
    await search.fetchLink();
    old.resolve({ kind: "available", text: "Old" });
    await pending;
    search.usePreview();
    expect(applied.mock.calls).toEqual([["New"]]);
  });
});

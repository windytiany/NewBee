import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import { createLyricsSearch } from "@/features/lyrics/download/search";
import { searchQuery } from "@/features/lyrics/download/query";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";

import type { TrackDetails } from "@/features/tracks/types";
import type { LyricsContent } from "@/features/lyrics/types";

import { notifications, notify } from "@/shared/notifications/center";

const scopes: Vue.EffectScope[] = [];
afterEach(() => {
  notifications.clear();
  for (const scope of scopes.splice(0)) scope.stop();
});
const source = await Bun.file("src/features/lyrics/download/LyricsSearch.vue").text();
const output = compileSfc(source, "LyricsSearch.vue", { inlineTemplate: false });
type Dialog = { open: boolean; showModal: () => void; close: () => void };
type Bindings = {
  state: ReturnType<typeof createLyricsSearch>["state"];
  search: ReturnType<typeof createLyricsSearch>;
  searchDialog: Vue.Ref<Dialog | null>;
  replaceDialog: Vue.Ref<Dialog | null>;
  pendingText: Vue.Ref<string | null>;
  automatic: () => Promise<void>;
  openSearch: () => Promise<void>;
  confirmReplace: () => void;
};
function dialog(): Dialog {
  const element = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
  return element;
}
function setup(
  modified = false,
  automatic: () => Promise<LyricsContent> = async () => ({ kind: "available", text: "downloaded" }),
  settings: () => { lyricsProviders: string[] } = () => ({ lyricsProviders: ["netease"] }),
) {
  const calls: string[] = [];
  const applied: string[] = [];
  let marked = 0;
  const props = Vue.reactive({
    track: {
      id: 1,
      title: "Song",
      artist: "Artist",
      path: "song.mp3",
      album: null,
      albumArtist: null,
      releaseDate: null,
      discNumber: null,
      trackNumber: null,
      discTotal: null,
      trackTotal: null,
      durationMs: null,
      codec: null,
      sampleRateHz: null,
      bitrateKbps: null,
      channels: null,
    } satisfies TrackDetails,
    modified,
    disabled: false,
  });
  const component = evaluateSource<{
    default: { setup: (properties: typeof props, context: object) => Bindings };
  }>(output, {
    vue: Vue,
    "@/shared/notifications/center": { notify },
    "@tauri-apps/api/core": {
      invoke: async (command: string) => {
        calls.push(command);
        if (command === "get_settings") return settings();
        if (command === "find_track_lyrics") return automatic();
        if (command === "search_lyrics_candidates")
          return {
            candidates: [
              {
                id: 2,
                provider: "netease",
                title: "Other",
                artists: ["Other Artist"],
                album: "Other Album",
                durationMs: null,
              },
            ],
            nextOffset: null,
          };
        if (command === "get_candidate_lyrics")
          return { kind: "available", text: "selected lyrics" };
        throw new Error(`Unexpected command ${command}`);
      },
    },
    "@/features/tracks/format": { formatTrackDuration: () => "0:01" },
    "@/features/lyrics/download/search": { createLyricsSearch },
    "@/features/lyrics/download/query": { searchQuery },
    "@/features/settings/events": { SETTINGS_CHANGED_EVENT },
  }).default;
  const scope = Vue.effectScope();
  scopes.push(scope);
  const bindings = scope.run(() =>
    component.setup(props, {
      emit: (name: string, text: string) => {
        if (name === "mark") marked++;
        else applied.push(text);
      },
      expose: () => {},
    }),
  );
  if (!bindings) throw new Error("Missing action bindings");
  bindings.searchDialog.value = dialog();
  bindings.replaceDialog.value = dialog();
  return { bindings, calls, applied, props, scope, marked: () => marked };
}

describe("lyrics editor actions", () => {
  it("notifies when lyrics providers are disabled without attempting downloads", async () => {
    const { bindings, calls } = setup(false, undefined, () => ({ lyricsProviders: [] }));
    await Vue.nextTick();
    expect(notifications.items.value[0]?.message).toBe("请先在设置中启用歌词来源。");
    await bindings.automatic();
    expect(calls).not.toContain("find_track_lyrics");
  });
  it("notifies settings read failures without attempting lyrics downloads", async () => {
    const { bindings, calls } = setup(false, undefined, () => {
      throw new Error("settings unavailable");
    });
    await Vue.nextTick();
    expect(notifications.items.value[0]?.message).toBe("读取歌词设置失败，请查看日志");
    await bindings.automatic();
    expect(calls).not.toContain("find_track_lyrics");
  });
  it("applies automatic results to the draft without a file-write command", async () => {
    const { bindings, calls, applied } = setup();
    await bindings.automatic();
    expect(applied).toEqual(["downloaded"]);
    expect(calls).toContain("find_track_lyrics");
    expect(calls.some((command) => command.includes("save") || command.includes("write"))).toBe(
      false,
    );
  });
  it("asks before replacing unsaved lyrics and applies only after confirmation", async () => {
    const { bindings, applied } = setup(true);
    await bindings.automatic();
    await Vue.nextTick();
    expect(applied).toEqual([]);
    expect(bindings.replaceDialog.value?.open).toBe(true);
    bindings.confirmReplace();
    await Vue.nextTick();
    expect(applied).toEqual(["downloaded"]);
    expect(bindings.replaceDialog.value?.open).toBe(false);
  });
  it("marks explicit instrumental results in the draft without writing a file", async () => {
    const { bindings, calls, marked, applied } = setup(false, async () => ({
      kind: "instrumental",
    }));
    await bindings.automatic();
    expect(marked()).toBe(1);
    expect(applied).toEqual([]);
    expect(calls.some((command) => command.includes("save") || command.includes("write"))).toBe(
      false,
    );
  });
  it("requires confirmation before a pure-music result clears unsaved lyrics", async () => {
    const { bindings, marked } = setup(true, async () => ({ kind: "instrumental" }));
    await bindings.automatic();
    await Vue.nextTick();
    expect(marked()).toBe(0);
    expect(bindings.replaceDialog.value?.open).toBe(true);
    bindings.confirmReplace();
    expect(marked()).toBe(1);
  });
  it("does not mark when no lyrics were found", async () => {
    const { bindings, marked, applied } = setup(false, async () => ({ kind: "missing" }));
    await bindings.automatic();
    expect(marked()).toBe(0);
    expect(applied).toEqual([]);
  });
  it("opens manual results and requires explicit candidate use", async () => {
    const { bindings, applied } = setup();
    await bindings.openSearch();
    expect(bindings.searchDialog.value?.open).toBe(true);
    expect(bindings.state.query).toBe("Song Artist");
    const candidate = bindings.state.candidates[0];
    if (!candidate) throw new Error("Missing candidate");
    await bindings.search.select(candidate);
    expect(applied).toEqual([]);
    bindings.search.usePreview();
    expect(applied).toEqual(["selected lyrics"]);
    expect(bindings.searchDialog.value?.open).toBe(false);
  });
  it("ignores a pending download after the editor has been destroyed", async () => {
    let resolve!: (value: LyricsContent) => void;
    const request = new Promise<LyricsContent>((done) => {
      resolve = done;
    });
    const { bindings, applied, scope } = setup(false, () => request);
    const loading = bindings.automatic();
    await Promise.resolve();
    await Promise.resolve();
    scope.stop();
    resolve({ kind: "available", text: "late" });
    await loading;
    expect(applied).toEqual([]);
  });
});

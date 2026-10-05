import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "../support/moduleLoader";
import { createLyricsSearch } from "@/lyricsDownload/search";
import { searchQuery } from "@/lyricsDownload/model";
import { SETTINGS_CHANGED_EVENT } from "@/settings/types";
import type { TrackDetails } from "@/library/model";
import type { LyricsContent } from "@/lyricsDownload/model";

const scopes: Vue.EffectScope[] = [];
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
});
const source = await Bun.file("src/lyricsDownload/ui/LyricsSearchActions.vue").text();
const output = compileSfc(source, "LyricsSearchActions.vue", { inlineTemplate: false });
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
) {
  const calls: string[] = [];
  const applied: string[] = [];
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
  const component = evaluateModule<{
    default: { setup: (properties: typeof props, context: object) => Bindings };
  }>(output, {
    vue: Vue,
    "@tauri-apps/api/core": {
      invoke: async (command: string) => {
        calls.push(command);
        if (command === "get_settings") return { lyricsProviders: ["netease"] };
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
    "@/library/formatTrack": { formatTrackDuration: () => "0:01" },
    "@/lyricsDownload/search": { createLyricsSearch },
    "@/lyricsDownload/model": { searchQuery },
    "@/settings/types": { SETTINGS_CHANGED_EVENT },
  }).default;
  const scope = Vue.effectScope();
  scopes.push(scope);
  const bindings = scope.run(() =>
    component.setup(props, {
      emit: (_name: string, text: string) => {
        applied.push(text);
      },
      expose: () => {},
    }),
  );
  if (!bindings) throw new Error("Missing action bindings");
  bindings.searchDialog.value = dialog();
  bindings.replaceDialog.value = dialog();
  return { bindings, calls, applied, props, scope };
}

describe("lyrics editor actions", () => {
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

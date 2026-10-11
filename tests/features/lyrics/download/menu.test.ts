import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";
import type { LibraryAlbumSelection } from "@/features/library/types";

const source = await Bun.file("src/features/lyrics/components/DownloadMenuItem.vue").text();
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
function mount(properties: { trackIds?: number[]; album?: LibraryAlbumSelection }) {
  const tracks: number[][] = [];
  const albums: LibraryAlbumSelection[] = [];
  const state = Vue.reactive({ running: false, synchronizationError: "" });
  let refreshed = 0;
  const props = Vue.reactive(properties);
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "DownloadMenuItem.vue"),
    {
      vue: Vue,
      "@/features/lyrics/download/batch": {
        useLyricsBatch: () => ({
          state,
          retrySynchronization: async () => {
            refreshed++;
            state.synchronizationError = "";
          },
        }),
      },
      "@/features/lyrics/download/confirmation": {
        useLyricsConfirmation: () => ({
          busy: Vue.computed(() => state.running),
          openTracks: async (ids: number[]) => {
            tracks.push(ids);
          },
          openAlbum: async (album: LibraryAlbumSelection) => {
            albums.push(album);
          },
        }),
      },
    },
  ).default;
  const root = createHostNode("root");
  let closed = 0;
  const app = createHostRenderer(createHostNode).createApp(
    Vue.defineComponent({
      setup: () => () =>
        Vue.h(component, {
          ...props,
          onClose: () => {
            closed++;
            props.trackIds = [99];
          },
        }),
    }),
  );
  app.mount(root);
  apps.push(app);
  const button = findNode(root, (node) => node.type === "button");
  if (!button) throw new Error("Missing lyrics menu item");
  return { root, button, tracks, albums, state, closed: () => closed, refreshed: () => refreshed };
}
it("does not offer a retry after a refresh failure", async () => {
  const result = mount({ trackIds: [1] });
  result.state.synchronizationError = "reload failed";
  await Vue.nextTick();
  expect(getTextContent(result.root)).not.toContain("重试");
  expect(result.refreshed()).toBe(0);
  expect(result.closed()).toBe(0);
  expect(result.tracks).toEqual([]);
});

it("retains the exact menu name and snapshots selected targets before closing", () => {
  const result = mount({ trackIds: [1, 2] });
  expect(getTextContent(result.button).trim()).toBe("更新缺少的歌词");
  const click = result.button.props.onClick as (event: { stopPropagation: () => void }) => void;
  click({ stopPropagation() {} });
  expect(result.closed()).toBe(1);
  expect(result.tracks).toEqual([[1, 2]]);
});
it("passes the selected album to the download confirmation", () => {
  const album = { album: "Album", albumArtist: "Artist" };
  const result = mount({ album });
  const click = result.button.props.onClick as (event: { stopPropagation: () => void }) => void;
  click({ stopPropagation() {} });
  expect(result.albums).toEqual([album]);
});
it("disables additional downloads while a batch is running", async () => {
  const result = mount({ trackIds: [1] });
  result.state.running = true;
  await Vue.nextTick();
  expect(result.button.props.disabled).toBe(true);
  const click = result.button.props.onClick as (event: { stopPropagation: () => void }) => void;
  click({ stopPropagation() {} });
  expect(result.tracks).toEqual([]);
});

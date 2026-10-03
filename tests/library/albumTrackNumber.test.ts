import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "../support/moduleLoader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../support/hostRenderer";
import { formatTrackDuration } from "@/library/formatTrack";

const source = await Bun.file(
  new URL("../../src/library/ui/AlbumTrack.vue", import.meta.url),
).text();
const component = evaluateModule<{ default: Vue.Component }>(
  compileSfc(source, "src/library/ui/AlbumTrack.vue", { id: "album-track-number-test" }),
  {
    vue: Vue,
    "@lucide/vue": { AudioLines: Vue.defineComponent({ setup: () => () => null }) },
    "@/library/formatTrack": { formatTrackDuration },
  },
).default;

describe("专辑曲号", () => {
  for (const [trackNumber, expected] of [
    [4, "4"],
    [1, "1"],
    [null, "-"],
  ] as const) {
    it(`显示元数据曲号 ${trackNumber ?? "缺失"}，不使用列表位置`, () => {
      const root = createHostNode("root");
      const app = createHostRenderer(createHostNode).createApp({
        setup: () => () =>
          Vue.h(component, {
            track: {
              id: 99,
              title: "Song",
              artist: "Artist",
              album: "Album",
              durationMs: 100,
              discNumber: 2,
              trackNumber,
            },
            albumArtist: "Artist",
            isFocused: false,
            isSelected: false,
            isCurrentTrack: false,
            isContextMenuOpen: false,
          }),
      });
      app.mount(root);
      try {
        const button = findNode(root, (node) => node.type === "button");
        const number = button?.children.find((node) => node.type === "span");
        expect(number && getTextContent(number).trim()).toBe(expected);
      } finally {
        app.unmount();
      }
    });
  }
});

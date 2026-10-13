import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../../../support/module/loader";
import { createHostNode, createHostRenderer, findNode } from "../../../../../support/host/renderer";
import { createItemSelection } from "@/shared/interaction/item/useSelection";
import { formatTrackDuration } from "@/features/tracks/format";

const source = await Bun.file(
  new URL("../../../../../../src/features/library/browser/albums/AlbumTrack.vue", import.meta.url),
).text();
const component = evaluateSource<{ default: Vue.Component }>(
  compileSfc(source, "src/features/library/browser/albums/AlbumTrack.vue", {
    id: "album-track-selection-test",
  }),
  {
    vue: Vue,
    "@lucide/vue": { AudioLines: Vue.defineComponent({ setup: () => () => null }) },
    "@/features/tracks/format": { formatTrackDuration },
  },
).default;

describe("音乐库曲目鼠标多选", () => {
  it.each([
    { ctrlKey: true, shiftKey: false, expected: ["1", "3"] },
    { ctrlKey: false, shiftKey: true, expected: ["1", "2", "3"] },
    { ctrlKey: true, shiftKey: true, expected: ["1", "2", "3"] },
  ])("原生焦点不清除选择或 Shift 锚点：%j", (modifiers) => {
    const selection = createItemSelection();
    const scope = "library:album-tracks";
    const keys = ["1", "2", "3"];
    selection.selectItem(scope, "1", keys, { ctrlKey: false, shiftKey: false });
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp({
      render: () =>
        Vue.h(component, {
          track: {
            id: 3,
            title: "Third",
            artist: "Artist",
            album: "Album",
            durationMs: 1000,
            discNumber: 1,
            trackNumber: 3,
          },
          albumArtist: "Artist",
          isFocused: false,
          isSelected: false,
          isCurrentTrack: false,
          isContextMenuOpen: false,
          onSelect: (event: { ctrlKey: boolean; shiftKey: boolean }) =>
            selection.selectItem(scope, "3", keys, event),
        }),
    });
    app.mount(root);
    try {
      const button = findNode(root, (node) => node.props["data-album-track-row"] !== undefined);
      if (!button) throw new Error("Album track row was not rendered.");
      selection.focusItem(scope, "3");
      const click = button.props.onClick;
      if (typeof click !== "function") throw new Error("Missing track click handler.");
      click({ button: 0, ...modifiers });
      expect(selection.selection.value?.selectedItemKeys).toEqual(modifiers.expected);
    } finally {
      app.unmount();
    }
  });
});

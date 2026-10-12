import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";

import { createHostNode, createHostRenderer, findNode } from "../../../support/host/renderer";
import type { PlaylistTrackSummary } from "@/features/playlist/types";
import { createItemSelection } from "@/shared/interaction/item/useSelection";

function createPlaylistTrackComponent(source: string) {
  const output = compileSfc(source, "src/features/playlist/tracks/PlaylistTrack.vue", {
    id: "playlist-track-drag-test",
  });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/features/library/format": { formatTrackDuration: () => "0:01" },
  };
  return evaluateSource<{ default: Vue.Component }>(output, modules).default;
}

const playlistTrack = createPlaylistTrackComponent(
  await Bun.file(
    new URL("../../../../src/features/playlist/tracks/PlaylistTrack.vue", import.meta.url),
  ).text(),
);
const track: PlaylistTrackSummary = {
  playlistItemId: 101,
  trackId: 1,
  title: "Track",
  artist: "Artist",
  album: "Album",
  durationMs: 1000,
};

describe("歌单曲目拖拽手势", () => {
  it.each([
    { ctrlKey: true, shiftKey: false, expected: ["101", "103"] },
    { ctrlKey: false, shiftKey: true, expected: ["101", "102", "103"] },
  ])("原生焦点切换后点击仍保留多选和 Shift 锚点：%j", (modifiers) => {
    const selection = createItemSelection();
    const scope = "playlist:tracks:7";
    const keys = ["101", "102", "103"];
    selection.selectItem(scope, "101", keys, { ctrlKey: false, shiftKey: false });
    const renderer = createHostRenderer(createHostNode);
    const root = createHostNode("root");
    const app = renderer.createApp({
      render: () =>
        Vue.h(playlistTrack, {
          track: { ...track, playlistItemId: 103 },
          trackNumber: 3,
          isFocused: false,
          isSelected: false,
          isCurrentTrack: false,
          onSelect: (event: { ctrlKey: boolean; shiftKey: boolean }) =>
            selection.selectItem(scope, "103", keys, event),
        }),
    });
    app.mount(root);
    try {
      const button = findNode(
        root,
        (node) => node.props["data-playlist-track-select"] !== undefined,
      );
      if (!button) throw new Error("Playlist track body was not rendered.");
      selection.focusItem(scope, "103");
      const click = button.props.onClick;
      if (typeof click !== "function") throw new Error("Missing track click handler.");
      click({ button: 0, ...modifiers });
      expect(selection.selection.value?.selectedItemKeys).toEqual(modifiers.expected);
    } finally {
      app.unmount();
    }
  });

  it("从曲目主体按下时启动重排手势", () => {
    const renderer = createHostRenderer(createHostNode);
    const emitted: Array<{ playlistItemId: number; event: unknown }> = [];
    const root = createHostNode("root");
    const app = renderer.createApp({
      render: () =>
        Vue.h(playlistTrack, {
          track,
          trackNumber: 1,
          isFocused: false,
          isSelected: false,
          isCurrentTrack: false,
          onReorderPointerDown: (playlistItemId: number, event: unknown) =>
            emitted.push({ playlistItemId, event }),
        }),
    });
    app.mount(root);

    try {
      const trackButton = findNode(
        root,
        (node) => node.props["data-playlist-track-select"] !== undefined,
      );
      if (!trackButton) throw new Error("Playlist track body was not rendered.");
      const pointerDown = trackButton.props.onPointerdown;
      if (typeof pointerDown !== "function") {
        throw new Error("Playlist track body does not start the reorder gesture.");
      }

      const touchEvent = { pointerType: "touch" };
      pointerDown(touchEvent);
      expect(emitted).toEqual([]);

      const mouseEvent = { pointerType: "mouse" };
      pointerDown(mouseEvent);
      expect(emitted).toEqual([{ playlistItemId: track.playlistItemId, event: mouseEvent }]);
    } finally {
      app.unmount();
    }
  });
});

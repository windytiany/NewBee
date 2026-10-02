import { describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateModule } from "../support/moduleLoader";
import { createHostNode, createHostRenderer, findNode } from "../support/hostRenderer";
import type { PlaylistTrackSummary } from "@/playlist/model";

function createPlaylistTrackComponent(source: string) {
  const output = compileSfc(source, "src/playlist/ui/PlaylistTrack.vue", {
    id: "playlist-track-drag-test",
  });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@/library/formatTrack": { formatTrackDuration: () => "0:01" },
  };
  return evaluateModule<{ default: Vue.Component }>(output, modules).default;
}

const playlistTrack = createPlaylistTrackComponent(
  await Bun.file(new URL("../../src/playlist/ui/PlaylistTrack.vue", import.meta.url)).text(),
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

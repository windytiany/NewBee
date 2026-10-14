import { afterEach, expect, test } from "bun:test";
import * as Vue from "vue";

import type { TrackDetails } from "@/features/tracks/types";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import { createHostRenderer, visit } from "../../../support/host/renderer";
import type { HostTree } from "../../../support/host/renderer";
import { playbackFixture } from "../../../support/playback/session";

interface HostNode extends HostTree<HostNode> {
  type: string;
}
function createNode(type: string, text = ""): HostNode {
  return { type, text, props: {}, children: [], parent: null };
}
const apps: Vue.App[] = [];
const sessions: Array<ReturnType<typeof playbackFixture>["session"]> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const session of sessions.splice(0)) session.dispose();
});

const source = await Bun.file(
  new URL("../../../../src/features/playback/current/TrackInfoPanel.vue", import.meta.url),
).text();

const details: TrackDetails = {
  id: 41,
  path: "/music/41.flac",
  title: "Track title",
  artist: "Track artist",
  album: "Track album",
  albumArtist: null,
  releaseDate: "2024",
  discNumber: null,
  trackNumber: null,
  discTotal: null,
  trackTotal: null,
  durationMs: 180000,
  codec: "flac",
  sampleRateHz: 44100,
  bitrateKbps: null,
  channels: 2,
};

async function settle() {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
    await Vue.nextTick();
  }
}

test("renders backend listening track details when playback starts after mounting", async () => {
  const fixture = playbackFixture();
  sessions.push(fixture.session);
  await fixture.session.ready;
  const calls: number[] = [];
  const artworkCalls: number[] = [];
  const placeholder = Vue.defineComponent(() => () => Vue.h("span"));
  const transition = Vue.defineComponent(
    (_props, { slots }) =>
      () =>
        slots.default?.(),
  );
  const { default: Panel } = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "TrackInfoPanel.vue"),
    {
      vue: { ...Vue, Transition: transition },
      "@lucide/vue": { Disc3: placeholder },
      "@/features/playback/session": { usePlaybackSession: () => fixture.session },
      "@/features/artwork/useArtworkSize": {
        useArtworkSize: (element: Vue.Ref<unknown>) => {
          const size = Vue.ref(0);
          Vue.watch(
            element,
            (target) => {
              size.value = target ? 256 : 0;
            },
            { flush: "post" },
          );
          return size;
        },
      },
      "@tauri-apps/api/core": {
        invoke: async (command: string, args: { trackId: number }) => {
          if (command === "is_track_metadata_pending") return false;
          if (command === "get_track_artwork") {
            artworkCalls.push(args.trackId);
            return new ArrayBuffer(0);
          }
          expect(command).toBe("get_track");
          calls.push(args.trackId);
          return details;
        },
      },
    },
  );
  const root = createNode("root");
  const app = createHostRenderer(createNode).createApp(Panel);
  apps.push(app);
  app.mount(root);
  fixture.emit({
    currentTrack: { trackId: 41, title: "Fallback title", artist: "Fallback artist" },
    currentPlaybackId: 7,
    currentRowKey: "row-41",
    playbackStatus: {
      hasAudio: true,
      isPlaying: true,
      hasEnded: false,
      positionMs: 0,
      durationMs: 180000,
    },
  });
  await settle();
  const texts: string[] = [];
  visit(root, (node) => {
    if (node.text) texts.push(node.text);
  });
  expect(calls).toEqual([41]);
  expect(artworkCalls).toEqual([41]);
  expect(texts.join(" ")).not.toContain("未播放");
  expect(texts.join(" ")).toContain("Track title");
  expect(texts.join(" ")).toContain("Track album");
  expect(texts.join(" ")).toContain("2024");
  expect(texts.join(" ")).toContain("flac");
});

import { afterEach, expect, it, mock } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import { createHostNode, createHostRenderer, findNode, visit } from "../../support/host/renderer";
import type { HostNode } from "../../support/host/renderer";
import type { TrackLyrics } from "@/features/lyrics/types";

const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  if (originalHTMLElement) Object.defineProperty(globalThis, "HTMLElement", originalHTMLElement);
  else Reflect.deleteProperty(globalThis, "HTMLElement");
});

const output = compileSfc(
  await Bun.file("src/features/lyrics/components/LyricsView.vue").text(),
  "src/features/lyrics/components/LyricsView.vue",
);

function mount(lyrics: TrackLyrics) {
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: class {} });
  const noop = () => {};
  const returnToCurrentLyric = mock(noop);
  const { default: LyricsView } = evaluateSource<{ default: Vue.Component }>(output, {
    vue: Vue,
    "@lucide/vue": { RefreshCw: Vue.defineComponent({ setup: () => () => null }) },
    "@/features/lyrics/composables/useFollow": {
      useLyricsFollow: () => ({
        state: Vue.ref("browsing"),
        handleScroll: noop,
        beginInteraction: noop,
        endInteraction: noop,
        startBrowsing: noop,
        returnToCurrentLyric,
      }),
      isLyricsScrollKey: () => false,
    },
  });
  const onSeek = mock(noop);
  const node = (type: string, text = ""): HostNode =>
    Object.assign(createHostNode(type, text), { style: {} });
  const root = node("root");
  const app = createHostRenderer(node).createApp(LyricsView, {
    lyrics,
    activeIndex: 0,
    activeGroupStartIndex: 0,
    canSeek: true,
    trackId: 1,
    visible: true,
    isSeeking: false,
    onSeek,
  });
  app.mount(root);
  apps.push(app);
  return { root, onSeek, returnToCurrentLyric };
}

it("excludes the lyrics container and its controls from Tab and F6 entries", () => {
  for (const lyrics of [
    { kind: "plain", text: "Plain lyrics" },
    { kind: "synced", lines: [{ startMs: 100, text: "First line" }] },
  ] satisfies TrackLyrics[]) {
    const { root } = mount(lyrics);
    const container = findNode(root, (node) => node.type === "section");
    expect(Number(container?.props.tabindex)).toBe(-1);
    visit(root, (node) => {
      if (node.type === "button") expect(Number(node.props.tabindex)).toBe(-1);
    });
  }
});

it("preserves clicking a lyric to seek and returning to the current lyric", () => {
  const h = mount({ kind: "synced", lines: [{ startMs: 100, text: "First line" }] });
  const line = findNode(h.root, (node) => node.type === "button" && node.parent?.type === "li");
  expect(line).not.toBeNull();
  (line!.props.onClick as () => void)();
  expect(h.onSeek).toHaveBeenCalledWith(100);
  const resume = findNode(h.root, (node) => node.props["aria-label"] === "恢复歌词跟随");
  expect(resume).not.toBeNull();
  (resume!.props.onClick as () => void)();
  expect(h.returnToCurrentLyric).toHaveBeenCalledTimes(1);
});

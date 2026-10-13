import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { createInbox } from "@/features/inbox/useInbox";
import type { InboxTrack } from "@/features/inbox/api";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import { createHostRenderer, findNode, getTextContent, visit } from "../../support/host/renderer";
const originals = new Map(
  ["document", "window", "Node", "Element", "HTMLElement", "innerWidth", "innerHeight"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
  ),
);
let focused: Scene | null = null;
class Scene {
  props: Record<string, unknown> = {};
  children: Scene[] = [];
  parent: Scene | null = null;
  style = { display: "" };
  constructor(
    public type: string,
    public text = "",
  ) {}
  get isConnected(): boolean {
    return this.type === "root" || this.parent?.isConnected === true;
  }
  focus() {
    focused = Vue.toRaw(this);
    let ancestor = this.parent;
    while (ancestor) {
      if (typeof ancestor.props.onFocusin === "function") {
        dispatch(ancestor, "onFocusin", { target: this });
      }
      ancestor = ancestor.parent;
    }
  }
  scrollIntoView() {}
  closest(selector: string): Scene | null {
    if (selector === "[data-item-interaction]" && "data-item-interaction" in this.props)
      return this;
    return this.parent?.closest(selector) ?? null;
  }
  contains(target: Scene): boolean {
    return target === this || this.children.some((child) => child.contains(target));
  }
  getBoundingClientRect() {
    return { left: 5, top: 5, right: 205, bottom: 205, width: 200, height: 200 };
  }
  querySelectorAll(selector: string): Scene[] {
    const nodes: Scene[] = [];
    visit<Scene>(this, (node) => {
      if (
        selector === "button[data-track-select]" &&
        node.type === "button" &&
        "data-track-select" in node.props
      )
        nodes.push(node);
    });
    return nodes;
  }
}
let app: Vue.App | null = null;
beforeEach(() => {
  focused = null;
  const globals: Record<string, unknown> = {
    document: new EventTarget(),
    window: new EventTarget(),
    Node: Scene,
    Element: Scene,
    HTMLElement: Scene,
    innerWidth: 1000,
    innerHeight: 800,
  };
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
});
afterEach(() => {
  app?.unmount();
  app = null;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function track(index: number): InboxTrack {
  const path = `C:\\music\\${index}.wav`;
  return {
    id: path,
    path,
    addedAt: new Date(2026, 0, index, 9, 5).getTime(),
    title: `Song ${index}`,
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    releaseDate: null,
    discNumber: null,
    trackNumber: null,
    discTotal: null,
    trackTotal: null,
    durationMs: 1000,
    codec: null,
    sampleRateHz: null,
    bitrateKbps: null,
    channels: null,
  };
}
async function mount(tracks: InboxTrack[] = [track(1), track(2), track(3)]) {
  const edited: Array<readonly (number | string)[]> = [];
  const matched: string[][] = [];
  const played: string[] = [];
  const inbox = createInbox({
    api: {
      read: async () => ({ tracks, failures: [] }),
      register: async () => [],
      remove: async () => {},
      ingest: async (paths) => paths.map((path) => ({ path, success: true, error: null })),
    },
    session: {
      playTracks: async (_tracks, key) => {
        played.push(key);
        return true;
      },
      addTracksToNext: async () => true,
      addTracksToQueueEnd: async () => true,
    },
    changed: () => {},
  });
  await inbox.refresh();
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(await Bun.file("src/features/inbox/pages/InboxPage.vue").text(), "InboxPage.vue"),
    {
      vue: Vue,
      "@lucide/vue": {
        ChevronDown: Vue.defineComponent(() => () => null),
        Check: Vue.defineComponent(() => () => null),
      },
      "@/features/inbox/useInbox": { useInbox: () => inbox },
      "@/features/playback/session": {
        usePlaybackSession: () => ({ state: { activeQueueRowKey: Vue.ref(null) } }),
      },
      "@/features/artwork/artist/ArtistPhoto.vue": {
        __esModule: true,
        default: Vue.defineComponent(() => {
          throw new Error("Inbox must not render ArtistPhoto");
        }),
      },
      "@/features/metadata/manual/useEditor": {
        useTagEditor: () => ({
          state: Vue.reactive({ open: false }),
          openTracks: (targets: readonly (number | string)[]) => {
            edited.push(targets);
          },
        }),
      },
      "@/features/metadata/releases/useEditor": {
        useReleaseEditor: () => ({
          state: Vue.reactive({ open: false }),
          openFiles: (paths: string[]) => {
            matched.push(paths);
          },
        }),
      },
      "@/shared/components/SidePane.vue": {
        __esModule: true,
        default: Vue.defineComponent(
          (_, { slots }) =>
            () =>
              Vue.h("aside", slots.default?.()),
        ),
      },
    },
  ).default;
  const root = new Scene("root");
  app = createHostRenderer((type, text) => new Scene(type, text)).createApp(component, {
    active: true,
  });
  app.mount(root);
  await settle();
  return {
    root,
    inbox,
    edited,
    matched,
    played,
    rows: () => root.querySelectorAll("button[data-track-select]"),
  };
}
async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
}
function dispatch(node: Scene, handler: string, fields: Record<string, unknown> = {}) {
  const callback = node.props[handler];
  if (typeof callback !== "function") throw new Error(`Missing handler ${handler}`);
  callback({
    button: 0,
    ctrlKey: false,
    shiftKey: false,
    currentTarget: node,
    target: node,
    preventDefault() {},
    stopPropagation() {},
    ...fields,
  });
}
function menuButton(root: Scene, label: string) {
  const button = findNode(
    root,
    (node) =>
      node.type === "button" && node.props.role === "menuitem" && getTextContent(node) === label,
  );
  if (!button) throw new Error(`Missing menu action ${label}`);
  return button;
}
function clickRow(root: Scene, row: Scene, modifiers: Record<string, unknown> = {}) {
  const list = findNode(root, (node) => node.type === "ol");
  if (!list) throw new Error("Missing track list");
  row.focus();
  dispatch(row, "onClick", modifiers);
}
describe("Inbox workspace", () => {
  it("keeps all artists without an empty artist notice when Inbox is empty", async () => {
    const context = await mount([]);
    expect(context.rows()).toHaveLength(0);
    expect(getTextContent(context.root)).toContain("所有艺术家");
    expect(getTextContent(context.root)).not.toContain("无演出者");
  });

  it("shows local added dates between album and duration without changing row order", async () => {
    const context = await mount();
    const rows = context.rows();
    expect(rows).toHaveLength(3);
    for (const [index, row] of rows.entries()) {
      const text = getTextContent(row);
      expect(text).toContain(`Song ${index + 1}`);
      expect(text).toContain(`2026-01-0${index + 1} 09:05`);
      expect(text.indexOf("Album")).toBeLessThan(text.indexOf("2026-"));
      expect(text.indexOf("2026-")).toBeLessThan(text.indexOf("0:01"));
    }
    expect(getTextContent(context.root)).toContain("添加日期");
  });

  it("preserves Ctrl toggles and Shift ranges through mouse focus before click", async () => {
    const context = await mount();
    clickRow(context.root, context.rows()[0]);
    clickRow(context.root, context.rows()[2], { ctrlKey: true });
    await settle();
    expect(context.rows().map((row) => row.props["aria-pressed"])).toEqual([true, undefined, true]);
    clickRow(context.root, context.rows()[2], { ctrlKey: true });
    await settle();
    expect(context.rows().map((row) => row.props["aria-pressed"])).toEqual([
      true,
      undefined,
      undefined,
    ]);
    clickRow(context.root, context.rows()[2], { shiftKey: true });
    await settle();
    expect(context.rows().map((row) => row.props["aria-pressed"])).toEqual([true, true, true]);
    expect(focused).toBe(context.rows()[2]);
    clickRow(context.root, context.rows()[1]);
    await settle();
    expect(context.rows().map((row) => row.props["aria-pressed"])).toEqual([
      undefined,
      true,
      undefined,
    ]);
  });
  it("renders only the compact table and text artists, without extra controls or a page header", async () => {
    const context = await mount();
    expect(context.rows()).toHaveLength(3);
    expect(getTextContent(context.root)).toContain("所有艺术家");
    expect(findNode(context.root, (node) => node.type === "header")).toBeNull();
    expect(
      findNode(context.root, (node) => node.type === "input" && node.props.type === "checkbox"),
    ).toBeNull();
    expect(getTextContent(context.root)).not.toContain("添加文件");
    expect(getTextContent(context.root)).not.toContain("添加目录");
  });
  it("uses shared Ctrl/Shift selection, right-click targets and menu focus restoration for the actual editors", async () => {
    const context = await mount();
    dispatch(context.rows()[0], "onClick");
    dispatch(context.rows()[2], "onClick", { shiftKey: true });
    await settle();
    expect(context.rows().map((row) => row.props["aria-pressed"])).toEqual([true, true, true]);
    dispatch(context.rows()[1], "onContextmenu", { clientX: 10, clientY: 20 });
    await settle();
    expect(focused).toBe(menuButton(context.root, "添加为下一首"));
    dispatch(menuButton(context.root, "编辑"), "onClick");
    await settle();
    expect(context.edited).toEqual([[track(1).path, track(2).path, track(3).path]]);
    expect(focused).toBe(context.rows()[1]);
    dispatch(context.rows()[1], "onClick");
    dispatch(context.rows()[1], "onKeydown", { key: "F10", shiftKey: true });
    await settle();
    dispatch(menuButton(context.root, "根据专辑更新标签"), "onClick");
    await settle();
    expect(context.matched).toEqual([[track(2).path]]);
    expect(getTextContent(context.root)).not.toContain("下载封面");
    expect(getTextContent(context.root)).not.toContain("下载歌词");
  });
  it("uses shared keyboard range navigation and restores a surviving row after removal", async () => {
    const context = await mount();
    const list = findNode(context.root, (node) => node.type === "ol");
    if (!list) throw new Error("Missing track list");
    dispatch(context.rows()[0], "onClick");
    dispatch(list, "onKeydown", { target: context.rows()[0], key: "ArrowDown", shiftKey: true });
    await settle();
    expect(context.rows().map((row) => row.props["aria-pressed"])).toEqual([true, true, undefined]);
    dispatch(list, "onKeydown", { target: context.rows()[1], key: "Enter" });
    expect(context.played).toEqual([`inbox:${track(2).path}`]);
    dispatch(context.rows()[0], "onContextmenu", { clientX: 0, clientY: 0 });
    await settle();
    dispatch(menuButton(context.root, "从 Inbox 移除"), "onClick");
    await settle();
    expect(context.rows()).toHaveLength(1);
    expect(getTextContent(context.rows()[0])).toContain("Song 3");
    expect(focused).toBe(context.rows()[0]);
  });
});

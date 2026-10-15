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
    if (selector === '[role="menu"]' && this.props.role === "menu") return this;
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
        selector === '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])' &&
        node.props.role === "menuitem" &&
        !node.props.disabled &&
        node.props["aria-disabled"] !== "true"
      )
        nodes.push(node);
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
    id: index,
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
  const registeredPaths: string[][] = [];
  const ingestedIds: number[][] = [];
  const messages: unknown[] = [];
  const edited: Array<readonly number[]> = [];
  const matched: number[][] = [];
  const played: string[] = [];
  const playbackOrders: Array<Array<number | null>> = [];
  const addedNext: Array<Array<number | null>> = [];
  const addedEnd: Array<Array<number | null>> = [];
  const scans: number[][] = [];
  const editorState = Vue.reactive({ open: false });
  const inbox = createInbox({
    reread: {
      pending: Vue.ref(false),
      reread: async (ids) => {
        scans.push([...ids]);
        return {
          results: ids.map((trackId) => ({ trackId, databaseUpdated: true, error: null })),
          refreshError: null,
        };
      },
    },
    api: {
      read: async () => ({ tracks, failures: [] }),
      register: async () => [],
      remove: async () => {},
      ingest: async (trackIds) => {
        ingestedIds.push(trackIds);
        return trackIds.map((id) => ({
          trackId: id,
          path: track(id).path,
          skipped: false,
          success: true,
          error: null,
        }));
      },
    },
    session: {
      playTracks: async (tracks, key) => {
        played.push(key);
        playbackOrders.push(tracks.map((track) => track.trackId));
        return true;
      },
      addTracksToNext: async (tracks) => {
        addedNext.push(tracks.map((track) => track.trackId));
        return true;
      },
      addTracksToQueueEnd: async (tracks) => {
        addedEnd.push(tracks.map((track) => track.trackId));
        return true;
      },
    },
    changed: () => {},
  });
  await inbox.refresh();
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(await Bun.file("src/features/inbox/pages/InboxPage.vue").text(), "InboxPage.vue"),
    {
      vue: Vue,
      "@/features/tracks/api": {
        createTracksApi: () => ({
          registerLocalFiles: async (paths: readonly string[]) => {
            registeredPaths.push([...paths]);
            throw new Error("Menu must not register or read original files");
          },
          getTracks: async (ids: readonly number[]) => ids.map(track),
        }),
      },
      "@/features/lyrics/download/DownloadMenuItem.vue": Vue.defineComponent({
        props: ["trackIds"],
        setup: (props) => () =>
          Vue.h(
            "button",
            { role: "menuitem", "data-lyrics-targets": JSON.stringify(props.trackIds) },
            "更新缺少的歌词",
          ),
      }),
      "@/features/playback/queue/components/SkipMenuItem.vue": Vue.defineComponent({
        props: ["trackIds"],
        setup: (props) => () =>
          Vue.h(
            "button",
            { role: "menuitem", "data-skip-targets": JSON.stringify(props.trackIds) },
            "跳过",
          ),
      }),
      "@/features/playlist/tracks/AppendMenuItem.vue": Vue.defineComponent({
        props: ["trackIds"],
        setup: (props) => () =>
          Vue.h(
            "button",
            { role: "menuitem", "data-append-targets": JSON.stringify(props.trackIds) },
            "添加到播放列表",
          ),
      }),
      "@/features/playlist/creation/CreatePlaylistDialog.vue": Vue.defineComponent({
        setup: () => () => null,
      }),
      "@/shared/notifications/center": { notify: (message: unknown) => messages.push(message) },
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
          state: editorState,
          openTracks: (targets: readonly number[]) => {
            edited.push(targets);
          },
        }),
      },
      "@/features/metadata/releases/useEditor": {
        useReleaseEditor: () => ({
          state: editorState,
          openTracks: (ids: number[]) => {
            matched.push(ids);
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
    playbackOrders,
    addedNext,
    addedEnd,
    registeredPaths,
    ingestedIds,
    scans,
    editorState,
    messages,
    rows: () => root.querySelectorAll("button[data-track-select]"),
  };
}
async function settle() {
  for (let turn = 0; turn < 4; turn++) await Vue.nextTick();
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
  it("F5 and the empty menu scan every Inbox ID, while selected reread uses only the selection", async () => {
    const context = await mount();
    context.inbox.state.artist = { artist: "Artist", albumCount: 1 };
    context.inbox.state.tracks[2]!.artist = "Other";
    context.inbox.state.tracks[2]!.albumArtist = "Other";
    await settle();
    expect(context.rows()).toHaveLength(2);
    const pane = findNode(context.root, (node) => node.props["data-local-drop"] === "Inbox");
    if (!pane) throw new Error("Missing Inbox pane");
    dispatch(pane, "onKeydown", { key: "F5" });
    await settle();
    expect(context.scans).toEqual([[1, 2, 3]]);
    dispatch(pane, "onContextmenu");
    await settle();
    dispatch(menuButton(context.root, "重新读取标签"), "onClick");
    await settle();
    expect(context.scans).toEqual([
      [1, 2, 3],
      [1, 2, 3],
    ]);
    clickRow(context.root, context.rows()[1]);
    dispatch(context.rows()[1], "onContextmenu");
    await settle();
    dispatch(menuButton(context.root, "重新读取标签"), "onClick");
    await settle();
    expect(context.scans).toEqual([[1, 2, 3], [1, 2, 3], [2]]);
    expect(context.registeredPaths).toEqual([]);
    expect(context.messages).toEqual([]);
  });
  it("blocks explicit scans while an editor is open", async () => {
    const context = await mount();
    const pane = findNode(context.root, (node) => node.props["data-local-drop"] === "Inbox");
    if (!pane) throw new Error("Missing Inbox pane");
    context.editorState.open = true;
    dispatch(pane, "onKeydown", { key: "F5" });
    dispatch(pane, "onContextmenu");
    await settle();
    expect(menuButton(context.root, "重新读取标签").props.disabled).toBe(true);
    dispatch(menuButton(context.root, "重新读取标签"), "onClick");
    await settle();
    expect(context.scans).toEqual([]);
  });
  it("ingests the selected numeric IDs without registering them again", async () => {
    const context = await mount();
    clickRow(context.root, context.rows()[1]);
    dispatch(context.rows()[1], "onContextmenu");
    await settle();
    dispatch(menuButton(context.root, "添加到音乐库"), "onClick");
    await settle();
    expect(context.ingestedIds).toEqual([[2]]);
    expect(context.inbox.state.tracks.map((track) => track.id)).toEqual([1, 3]);
    expect(context.registeredPaths).toEqual([]);
  });

  it("groups track actions and resolves identities without importing or removing Inbox files", async () => {
    const context = await mount();
    clickRow(context.root, context.rows()[0]);
    clickRow(context.root, context.rows()[2], { shiftKey: true });
    dispatch(context.rows()[1], "onContextmenu");
    await settle();
    const items: string[] = [];
    const menu = findNode(context.root, (node) => node.props.id === "inbox-context-menu");
    if (!menu) throw new Error("Missing Inbox menu");
    visit(menu, (node) => {
      if (node.props.role === "menuitem") items.push(getTextContent(node));
      if (node.props.role === "separator") items.push("|");
    });
    expect(items).toEqual([
      "添加为下一首",
      "添加到队尾",
      "跳过",
      "|",
      "添加到播放列表",
      "添加到音乐库",
      "|",
      "编辑",
      "根据专辑更新标签",
      "更新缺少的歌词",
      "重新读取标签",
      "|",
      "从 Inbox 移除",
    ]);
    for (const key of ["lyrics", "skip", "append"]) {
      expect(
        findNode(context.root, (node) => `data-${key}-targets` in node.props)?.props[
          `data-${key}-targets`
        ],
      ).toBe("[1,2,3]");
    }
    expect(context.registeredPaths).toEqual([]);
    expect(context.ingestedIds).toEqual([]);
    expect(context.inbox.state.tracks).toHaveLength(3);
  });
  it("uses all snapshot IDs even when original files are offline", async () => {
    const context = await mount(
      [track(1), track(2), track(3)].map((track) => ({
        ...track,
        path: `Z:\\offline\\${track.id}.wav`,
      })),
    );
    clickRow(context.root, context.rows()[0]);
    clickRow(context.root, context.rows()[2], { shiftKey: true });
    dispatch(context.rows()[1], "onContextmenu");
    await settle();
    expect(menuButton(context.root, "添加到播放列表").props["data-append-targets"]).toBe("[1,2,3]");
    expect(menuButton(context.root, "更新缺少的歌词").props["data-lyrics-targets"]).toBe("[1,2,3]");
    expect(context.inbox.state.tracks).toHaveLength(3);
    expect(context.ingestedIds).toEqual([]);
    expect(context.messages).toEqual([]);
    expect(context.registeredPaths).toEqual([]);
  });
  it("keeps numeric selection and menu targets stable when snapshot paths change", async () => {
    const context = await mount();
    clickRow(context.root, context.rows()[1]);
    dispatch(context.rows()[1], "onContextmenu");
    await settle();
    const row = context.rows()[1];
    context.inbox.state.tracks[1]!.path = "Z:\\offline\\renamed.wav";
    await settle();
    expect(context.rows()[1]).toBe(row);
    expect(context.rows()[1]!.props["aria-pressed"]).toBe(true);
    expect(menuButton(context.root, "添加到播放列表").props["data-append-targets"]).toBe("[2]");
    dispatch(menuButton(context.root, "编辑"), "onClick");
    await settle();
    expect(context.edited).toEqual([[2]]);
    expect(context.registeredPaths).toEqual([]);
  });
  it("keeps all artists without an empty artist notice when Inbox is empty", async () => {
    const context = await mount([]);
    expect(context.rows()).toHaveLength(0);
    expect(getTextContent(context.root)).toContain("所有艺术家");
    expect(getTextContent(context.root)).not.toContain("无演出者");
  });

  it("shrinks all content columns together with single-line headers and dates", async () => {
    const context = await mount();
    const pane = findNode(
      context.root,
      (node) => node.type === "section" && node.props["data-local-drop"] === "Inbox",
    );
    expect(String(pane?.props.class).split(/\s+/)).toContain("overflow-y-auto");
    expect(
      findNode(context.root, (node) => String(node.props.class).includes("min-w-[")),
    ).toBeNull();
    const header = findNode(context.root, (node) =>
      String(node.props.class).includes("sticky top-0"),
    );
    if (!header) throw new Error("Missing table header");
    const columns = "sm:grid-cols-[var(--table-desktop-columns)]";
    expect(String(header.props.class).split(/\s+/)).toContain(columns);
    const labels: Scene[] = [];
    visit(header, (node) => {
      if (node.type === "span" && String(node.props.class).split(/\s+/).includes("truncate"))
        labels.push(node);
    });
    expect(labels).toHaveLength(5);
    for (const label of labels)
      expect(String(label.props.class).split(/\s+/)).toContain("truncate");
    for (const row of context.rows()) {
      expect(String(row.props.class)).toContain("sm:grid-cols-[var(--table-desktop-columns,");
      expect(String(row.props.class).split(/\s+/)).toContain("w-full");
      const date = findNode(
        row,
        (node) => node.type === "span" && getTextContent(node).startsWith("2026-"),
      );
      expect(String(date?.props.class).split(/\s+/)).toContain("truncate");
    }
  });

  it("applies resized proportions to the table without triggering sorting", async () => {
    const context = await mount();
    const separator = findNode(context.root, (node) => node.props["data-table-resize"] === "title");
    if (!separator) throw new Error("Missing resize handle");
    const widths = [32, 180, 120, 120, 48];
    const columnKeys = ["number", "title", "album", "addedAt", "durationMs"];
    dispatch(separator, "onPointerdown", {
      pointerId: 1,
      clientX: 100,
      currentTarget: {
        closest: () => ({
          querySelectorAll: () =>
            columnKeys.map((key, index) => ({
              dataset: { tableColumn: key },
              getBoundingClientRect: () => ({ width: widths[index] }),
            })),
        }),
      },
    });
    const event = new Event("pointermove");
    Object.assign(event, { pointerId: 1, clientX: 140 });
    window.dispatchEvent(event);
    await settle();
    const container = findNode(context.root, (node) => {
      const style = node.props.style;
      return typeof style === "object" && style !== null && "--table-desktop-columns" in style;
    });
    expect(container?.props.style).toMatchObject({
      "--table-desktop-columns":
        "minmax(0,32fr) minmax(0,220fr) minmax(0,80fr) minmax(0,120fr) minmax(0,48fr)",
    });
    expect(context.rows().map((row) => getTextContent(row).match(/Song \d/)?.[0])).toEqual([
      "Song 1",
      "Song 2",
      "Song 3",
    ]);
    expect(findNode(context.root, (node) => node.props["aria-sort"] === "ascending")).toBeNull();
  });

  it("sorts by header clicks in both directions without changing source order", async () => {
    const context = await mount([track(3), track(1), track(2)]);
    const sortBy = async (key: string) => {
      const button = findNode(context.root, (node) => node.props["data-table-sort"] === key);
      if (!button) throw new Error("Missing sort button");
      dispatch(button, "onClick");
      await settle();
    };
    const titles = () => context.rows().map((row) => getTextContent(row).match(/Song \d/)?.[0]);
    await sortBy("title");
    expect(titles()).toEqual(["Song 1", "Song 2", "Song 3"]);
    dispatch(context.rows()[1], "onDblclick");
    expect(context.playbackOrders).toEqual([[1, 2, 3]]);
    expect(context.played).toEqual(["inbox:2"]);
    clickRow(context.root, context.rows()[0]);
    clickRow(context.root, context.rows()[2], { shiftKey: true });
    await settle();
    expect(context.rows().map((row) => row.props["aria-pressed"])).toEqual([true, true, true]);
    await sortBy("title");
    expect(titles()).toEqual(["Song 3", "Song 2", "Song 1"]);
    const list = findNode(context.root, (node) => node.type === "ol");
    if (!list) throw new Error("Missing track list");
    dispatch(list, "onKeydown", { target: context.rows()[0], key: "Enter" });
    expect(context.playbackOrders[1]).toEqual([3, 2, 1]);
    expect(context.played[1]).toBe("inbox:3");
    dispatch(context.rows()[0], "onContextmenu", { clientX: 10, clientY: 20 });
    await settle();
    dispatch(menuButton(context.root, "添加为下一首"), "onClick");
    await settle();
    expect(context.addedNext).toEqual([[3, 2, 1]]);
    dispatch(context.rows()[0], "onContextmenu", { clientX: 10, clientY: 20 });
    await settle();
    dispatch(menuButton(context.root, "添加到队尾"), "onClick");
    await settle();
    expect(context.addedEnd).toEqual([[3, 2, 1]]);
    await sortBy("addedAt");
    expect(titles()).toEqual(["Song 1", "Song 2", "Song 3"]);
    await sortBy("addedAt");
    expect(titles()).toEqual(["Song 3", "Song 2", "Song 1"]);
    await sortBy("number");
    expect(titles()).toEqual(["Song 3", "Song 1", "Song 2"]);
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
    expect(context.edited).toEqual([[1, 2, 3]]);
    expect(focused).toBe(context.rows()[1]);
    dispatch(context.rows()[1], "onClick");
    dispatch(context.rows()[1], "onKeydown", { key: "F10", shiftKey: true });
    await settle();
    dispatch(menuButton(context.root, "根据专辑更新标签"), "onClick");
    await settle();
    expect(context.matched).toEqual([[2]]);
    expect(getTextContent(context.root)).not.toContain("下载封面");
    expect(getTextContent(context.root)).not.toContain("下载歌词");
  });
  it("Ctrl+A selects all tracks without moving focus and uses them as menu targets", async () => {
    const context = await mount();
    const list = findNode(context.root, (node) => node.type === "ol");
    if (!list) throw new Error("Missing track list");
    const row = context.rows()[1]!;
    row.focus();
    dispatch(list, "onFocusin", { target: row });
    dispatch(row, "onClick");
    dispatch(list, "onKeydown", { target: row, key: "a", ctrlKey: true });
    await settle();
    expect(context.rows().map((item) => item.props["aria-pressed"])).toEqual([true, true, true]);
    expect(focused).toBe(row);
    dispatch(row, "onContextmenu", { clientX: 0, clientY: 0 });
    await settle();
    dispatch(menuButton(context.root, "编辑"), "onClick");
    await settle();
    expect(context.edited).toEqual([[1, 2, 3]]);
    expect(focused).toBe(row);
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
    expect(context.played).toEqual(["inbox:2"]);
    dispatch(context.rows()[0], "onContextmenu", { clientX: 0, clientY: 0 });
    await settle();
    dispatch(menuButton(context.root, "从 Inbox 移除"), "onClick");
    await settle();
    expect(context.rows()).toHaveLength(1);
    expect(getTextContent(context.rows()[0])).toContain("Song 3");
    expect(focused).toBe(context.rows()[0]);
  });
});

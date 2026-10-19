import { afterEach, beforeEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { createItemSelection } from "@/shared/interaction/item/useSelection";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostRenderer,
  findNode,
  getTextContent,
  visit,
} from "../../../support/host/renderer";

const source = await Bun.file("src/features/playback/queue/components/QueueList.vue").text();
const originals = new Map(
  ["document", "window", "Node", "HTMLElement", "innerWidth", "innerHeight"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
const apps: Vue.App[] = [];
let focused: Scene | null = null;
class Scene {
  props: Record<string, unknown> = {};
  children: Scene[] = [];
  parent: Scene | null = null;
  constructor(
    public type: string,
    public text = "",
  ) {}
  get isConnected(): boolean {
    return this.type === "root" || this.parent?.isConnected === true;
  }
  focus() {
    focused = Vue.toRaw(this);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 224, bottom: 240, width: 224, height: 240 };
  }
  contains(target: Scene): boolean {
    return target === this || this.children.some((child) => child.contains(target));
  }
  closest(selector: string): Scene | null {
    if (selector === '[role="menu"]' && this.props.role === "menu") return this;
    return this.parent?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): Scene[] {
    const matches: Scene[] = [];
    visit<Scene>(this, (node) => {
      if (
        selector === '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])' &&
        node.props.role === "menuitem" &&
        !node.props.disabled &&
        node.props["aria-disabled"] !== "true"
      )
        matches.push(node);
    });
    return matches;
  }
}
beforeEach(() => {
  focused = null;
  for (const [key, value] of Object.entries({
    document: new EventTarget(),
    window: new EventTarget(),
    Node: Scene,
    HTMLElement: Scene,
    innerWidth: 800,
    innerHeight: 600,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
});
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
async function settle() {
  for (let turn = 0; turn < 4; turn++) await Vue.nextTick();
}
function dispatch(node: Scene, name: string, fields: Record<string, unknown> = {}) {
  const handler = node.props[name];
  if (typeof handler !== "function") throw new Error(`Missing handler ${name}`);
  handler({
    currentTarget: node,
    target: node,
    preventDefault() {},
    stopPropagation() {},
    ctrlKey: false,
    shiftKey: false,
    ...fields,
  });
}
async function mount(selected: string[] = [], registered = true) {
  const scope = "playback:queue";
  const selection = createItemSelection();
  const keys = ["first", "second", "duplicate"];
  for (const key of selected)
    selection.selectItem(scope, key, keys, { ctrlKey: true, shiftKey: false });
  const played: string[] = [];
  const removed: string[][] = [];
  const row = Vue.defineComponent({
    props: ["rowKey"],
    emits: ["contextMenu"],
    setup:
      (props, { emit }) =>
      () =>
        Vue.h("button", {
          "data-row-key": props.rowKey,
          onContextmenu: (event: { currentTarget: Scene }) =>
            emit("contextMenu", {
              rowKey: props.rowKey,
              x: 790,
              y: 590,
              trigger: event.currentTarget,
            }),
        }),
  });
  const item = (label: string) =>
    Vue.defineComponent({
      props: ["trackIds"],
      setup: (props) => () =>
        Vue.h(
          "button",
          { role: "menuitem", "data-targets": JSON.stringify(props.trackIds) },
          label,
        ),
    });
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, "QueueList.vue"),
    {
      vue: Vue,
      "@lucide/vue": { ChevronRight: Vue.defineComponent({ setup: () => () => null }) },
      "@/shared/interaction/item/useSelection": {
        useItemSelection: () => ({
          isSelected: (key: string) => selection.isSelected(scope, key),
          isFocused: (key: string) => selection.isFocused(scope, key),
          syncVisibleItems: (keys: string[]) => selection.syncVisibleItems(scope, keys),
          contextMenuTargets: (key: string, keys: string[]) =>
            selection.contextMenuTargets(scope, key, keys),
        }),
      },
      "@/features/playback/queue/components/QueueRow.vue": row,
      "@/features/playback/queue/components/SkipMenuItem.vue": item("跳过"),
      "@/features/metadata/manual/components/EditMenuItem.vue": item("编辑"),
      "@/features/tracks/presentation/RereadMenuItem.vue": item("重新读取标签"),
      "@/features/loudness/AnalysisMenuItem.vue": item("分析响度"),
      "@/features/loudness/RestoreMenuItem.vue": item("恢复原始响度"),
    },
  ).default;
  const root = new Scene("root");
  const app = createHostRenderer((type, text) => new Scene(type, text)).createApp(component, {
    canRemoveFromQueue: true,
    tracks: keys.map((rowKey, index) => ({
      rowKey,
      trackId: registered ? (index === 2 ? 7 : index + 7) : null,
      path: registered ? undefined : `C:\\${rowKey}.flac`,
      title: rowKey,
      album: null,
      durationMs: 100,
    })),
    onPlayQueueItem: (rowKey: string) => played.push(rowKey),
    onRemoveQueueItems: (rowKeys: string[]) => removed.push(rowKeys),
  });
  app.mount(root);
  apps.push(app);
  const rows = (key: string) => {
    const node = findNode(root, (node) => node.props["data-row-key"] === key);
    if (!node) throw new Error("Missing queue occurrence");
    return node;
  };
  const button = (label: string) =>
    findNode(root, (node) => node.type === "button" && getTextContent(node) === label);
  return { root, played, removed, rows, button };
}
it("groups actions and immediately plays the selected queue occurrence rather than its duplicate", async () => {
  const context = await mount();
  dispatch(context.rows("duplicate"), "onContextmenu");
  await settle();
  const menu = findNode(context.root, (node) => node.props.role === "menu");
  if (!menu) throw new Error("Missing queue menu");
  const labels: string[] = [];
  visit(menu, (node) => {
    if (node.props.role === "menuitem") labels.push(getTextContent(node).trim());
    if (node.props.role === "separator") labels.push("|");
  });
  expect(labels).toEqual([
    "立刻播放",
    "跳过",
    "|",
    "编辑",
    "根据曲目更新标签",
    "|",
    "从播放队列移除",
  ]);
  expect(String(menu.props.class).split(/\s+/)).toContain("w-56");
  expect(menu.props.style).toEqual({ left: "576px", top: "360px" });
  const play = context.button("立刻播放");
  if (!play) throw new Error("Missing immediate playback");
  expect(focused).toBe(play);
  dispatch(play, "onClick");
  await settle();
  expect(context.played).toEqual(["duplicate"]);
  expect(context.removed).toEqual([]);
  expect(findNode(context.root, (node) => node.props.role === "menu")).toBeNull();
  expect(focused).toBe(context.rows("duplicate"));
});
it("hides immediate playback for multiple queue occurrences even if they reference one track", async () => {
  const context = await mount(["first", "duplicate"]);
  dispatch(context.rows("duplicate"), "onContextmenu");
  await settle();
  expect(context.button("立刻播放")).toBeNull();
  expect(focused).toBe(context.button("跳过"));
  const remove = context.button("从播放队列移除");
  if (!remove) throw new Error("Missing removal");
  dispatch(remove, "onClick");
  await settle();
  expect(context.removed).toEqual([["first", "duplicate"]]);
  expect(context.played).toEqual([]);
});
it("supports immediate playback of a single path-backed row and collapses unselected targets", async () => {
  const context = await mount(["first", "duplicate"], false);
  dispatch(context.rows("second"), "onContextmenu");
  await settle();
  const play = context.button("立刻播放");
  if (!play) throw new Error("Missing immediate playback");
  expect(context.button("跳过")).toBeNull();
  const update = findNode(context.root, (node) => node.props["aria-haspopup"] === "menu");
  if (!update) throw new Error("Missing tag update submenu");
  dispatch(update, "onMouseenter");
  await settle();
  const analysis = context.button("分析响度");
  expect(analysis?.props.paths).toEqual(["C:\\second.flac"]);
  expect(analysis?.props["data-targets"]).toBe("[]");
  const restoration = context.button("恢复原始响度");
  expect(restoration?.props.paths).toEqual(["C:\\second.flac"]);
  expect(restoration?.props["data-targets"]).toBe("[]");
  dispatch(play, "onClick");
  await settle();
  expect(context.played).toEqual(["second"]);
});

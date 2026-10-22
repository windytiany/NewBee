import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { useTrackSelectionKeyboard } from "@/features/tracks/selection/useKeyboard";
import { createItemKeyboard } from "@/shared/interaction/item/keyboard";
import { createItemSelection } from "@/shared/interaction/item/useSelection";
import { createHostNode, createHostRenderer } from "../../../support/host/renderer";

class TestElement {
  isConnected = true;
  visible = true;
  blocked = false;
  context = "";
  tagName = "BUTTON";
  isContentEditable = false;
  getClientRects() {
    return this.visible ? [{}] : [];
  }
  closest(selector: string) {
    return this.blocked || (this.context && selector.includes(this.context)) ? this : null;
  }
}

const originals = new Map<string, PropertyDescriptor | undefined>();
let app: Vue.App | undefined;
let documentTarget: EventTarget & { querySelectorAll: () => TestElement[] };
let overlays: TestElement[];

beforeEach(() => {
  overlays = [];
  documentTarget = Object.assign(new EventTarget(), { querySelectorAll: () => overlays });
  for (const [name, value] of Object.entries({
    document: documentTarget,
    HTMLElement: TestElement,
    Element: TestElement,
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

function mount() {
  const selection = createItemSelection();
  const keys = ["1", "2", "3"];
  const list = new TestElement();
  const listRef = Vue.shallowRef(list as unknown as HTMLElement | null);
  const keyboard = createItemKeyboard({
    getItemKeys: () => keys,
    itemSelector: "button",
    onFocus: () => {},
    onMove: () => {},
    onSelectAll: (keys) => selection.selectAll("tracks", keys),
  });
  app = createHostRenderer(createHostNode).createApp({
    setup() {
      useTrackSelectionKeyboard(listRef, keyboard);
      return () => null;
    },
  });
  app.mount(createHostNode("root"));
  return { list, listRef, selected: () => selection.getSelectedItemKeys("tracks", keys) };
}

function press(target?: TestElement, modifiers: KeyboardEventInit = {}) {
  const event = Object.assign(new Event("keydown", { cancelable: true }), {
    key: "a",
    ctrlKey: true,
    ...modifiers,
  });
  if (target) Object.defineProperty(event, "target", { value: target });
  documentTarget.dispatchEvent(event);
  return event;
}

describe("曲目页面全选", () => {
  it("无曲目焦点或选择时直接全选，卸载后停止处理", () => {
    const harness = mount();
    expect(harness.selected()).toEqual([]);
    expect(press().defaultPrevented).toBe(true);
    expect(harness.selected()).toEqual(["1", "2", "3"]);
    app?.unmount();
    app = undefined;
    expect(press().defaultPrevented).toBe(false);
  });

  it.each(["hidden", "detached", "inert", "missing"])("忽略 %s 列表", (state) => {
    const harness = mount();
    if (state === "hidden") harness.list.visible = false;
    if (state === "detached") harness.list.isConnected = false;
    if (state === "inert") harness.list.blocked = true;
    if (state === "missing") harness.listRef.value = null;
    expect(press().defaultPrevented).toBe(false);
    expect(harness.selected()).toEqual([]);
  });

  it.each(['[data-local-drop="queue"]', '[role="menu"]', "dialog"])(
    "%s 内的事件不触发页面全选",
    (context) => {
      const harness = mount();
      const target = new TestElement();
      target.context = context;
      expect(press(target).defaultPrevented).toBe(false);
      expect(harness.selected()).toEqual([]);
    },
  );

  it("打开菜单或对话框时不全选背景列表", () => {
    const harness = mount();
    overlays.push(new TestElement());
    expect(press().defaultPrevented).toBe(false);
    expect(harness.selected()).toEqual([]);
    overlays[0].visible = false;
    expect(press().defaultPrevented).toBe(true);
  });

  it.each(["INPUT", "TEXTAREA", "SELECT", "editable"])("保留 %s 原生全选", (tagName) => {
    const harness = mount();
    const target = new TestElement();
    target.tagName = tagName;
    target.isContentEditable = tagName === "editable";
    expect(press(target).defaultPrevented).toBe(false);
    expect(harness.selected()).toEqual([]);
  });

  it.each([
    { ctrlKey: false },
    { shiftKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
  ])("忽略其他组合键 %j", (modifiers) => {
    const harness = mount();
    expect(press(undefined, modifiers).defaultPrevented).toBe(false);
    expect(harness.selected()).toEqual([]);
  });
});

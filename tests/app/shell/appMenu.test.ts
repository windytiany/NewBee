import { setLocale } from "@/shared/i18n/locale";
import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";

import { createHostRenderer, findNode, getTextContent, visit } from "../../support/hostRenderer";
import type { HostTree } from "../../support/hostRenderer";
import type { AppMenuAction } from "@/app/shell/AppMenu.vue";

let focused: MenuNode | null = null;
class MenuNode implements HostTree<MenuNode> {
  props: Record<string, unknown> = {};
  children: MenuNode[] = [];
  parent: MenuNode | null = null;
  constructor(
    public type: string,
    public text = "",
  ) {}
  get dataset() {
    return { submenu: this.props["data-submenu"] };
  }
  focus() {
    focused = Vue.toRaw(this);
    const listener = this.props.onFocus;
    if (typeof listener === "function") listener();
  }
  matches(selector: string) {
    if (selector.startsWith("#")) return this.props.id === selector.slice(1);
    const tag = selector.match(/^[a-z]+/)?.[0];
    if (tag && tag !== this.type) return false;
    for (const [, attribute, value] of selector.matchAll(/\[([\w-]+)="([^"]+)"\]/g)) {
      if (this.props[attribute!] !== value) return false;
    }
    return !selector.includes(":not(:disabled)") || !this.props.disabled;
  }
  closest(selector: string): MenuNode | null {
    if (this.matches(selector)) return this;
    return this.parent?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string) {
    const nodes: MenuNode[] = [];
    for (const child of this.children) {
      visit(child, (node) => {
        if (node.matches(selector)) nodes.push(node);
      });
    }
    return nodes;
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  contains(target: MenuNode): boolean {
    return target === this || (target.parent !== null && this.contains(target.parent));
  }
}

const globals = ["document", "Node", "Element"] as const;
const originals = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  globals.forEach((name, index) => {
    const original = originals[index];
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  });
  focused = null;
  setLocale("zh-CN");
});

const output = compileSfc(
  await Bun.file(new URL("../../../src/app/shell/AppMenu.vue", import.meta.url)).text(),
  "src/app/shell/AppMenu.vue",
);
const component = evaluateSource<{ default: Vue.Component }>(output, {
  vue: Vue,
  "@lucide/vue": { ChevronRight: () => Vue.h("svg") },
}).default;

function fire(node: MenuNode, listenerName = "onClick", details: Record<string, unknown> = {}) {
  const listener = node.props[listenerName];
  const event = { target: node, stopPropagation: () => {}, preventDefault: () => {}, ...details };
  if (Array.isArray(listener)) {
    for (const callback of listener) callback(event);
    return;
  }
  if (typeof listener !== "function") throw new Error(`Missing ${listenerName} on ${node.type}`);
  return listener(event);
}

function createMenu(canImport = true, isImporting = false) {
  const document = Object.assign(new EventTarget(), { documentElement: { lang: "zh-CN" } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "Node", { configurable: true, value: MenuNode });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: MenuNode });
  const props = Vue.reactive({ canImport, isImporting });
  const actions: AppMenuAction[] = [];
  const renderer = createHostRenderer((type, text) => Vue.markRaw(new MenuNode(type, text)));
  const root = Vue.markRaw(new MenuNode("root"));
  const app = renderer.createApp({
    setup: () => () =>
      Vue.h(component, {
        ...props,
        onSelect: (action: AppMenuAction) => {
          expect(findNode(root, (node) => node.props.id === "brand-menu")).toBeNull();
          expect(focused).toBe(button("NewBee"));
          actions.push(action);
        },
      }),
  });
  app.mount(root);
  apps.push(app);
  function button(label: string) {
    const node = findNode(
      root,
      (node) => node.type === "button" && getTextContent(node).trim() === label,
    );
    if (!node) throw new Error(`Missing button: ${label}`);
    return node;
  }
  function menu() {
    const node = findNode(root, (node) => node.props.id === "brand-menu");
    if (!node) throw new Error("Menu is closed");
    return node;
  }
  async function open() {
    fire(button("NewBee"));
    await Vue.nextTick();
  }
  async function key(key: string) {
    if (!focused) throw new Error("No focused menu item");
    fire(menu(), "onKeydown", { key, target: focused });
    await Vue.nextTick();
  }
  function rootLabels() {
    const rootMenu = menu();
    return rootMenu
      .querySelectorAll('button[role="menuitem"]')
      .filter((item) => item.closest('[role="menu"]') === rootMenu)
      .map((item) => getTextContent(item).trim());
  }
  return { root, app, document, props, actions, button, menu, open, key, rootLabels };
}

function dispatchPointer(document: EventTarget, target: MenuNode) {
  const event = new Event("pointerdown");
  Object.defineProperty(event, "target", { value: target });
  document.dispatchEvent(event);
}

describe("brand menu", () => {
  it("groups file and tool actions into right-hand submenus, leaving settings at the root", async () => {
    const menu = createMenu();
    await menu.open();
    expect(menu.rootLabels()).toEqual(["文件", "工具", "设置"]);
    fire(menu.button("文件").parent!, "onMouseenter");
    await Vue.nextTick();
    expect(menu.button("文件").props["aria-expanded"]).toBe(true);
    expect(menu.button("导入音频文件").closest('[role="menu"]')?.props.id).toBe("brand-menu-file");
    expect(menu.button("扫描文件夹").closest('[role="menu"]')?.props.id).toBe("brand-menu-file");
    fire(menu.button("工具").parent!, "onMouseenter");
    await Vue.nextTick();
    expect(menu.button("文件").props["aria-expanded"]).toBe(false);
    expect(menu.button("路径迁移").closest('[role="menu"]')?.props.id).toBe("brand-menu-tools");
    expect(getTextContent(menu.menu())).not.toContain("导入音频文件");
    fire(menu.button("设置"), "onMouseenter");
    await Vue.nextTick();
    expect(menu.rootLabels()).toEqual(["文件", "工具", "设置"]);
  });

  for (const [group, label, action] of [
    ["文件", "导入音频文件", "import"],
    ["文件", "扫描文件夹", "scan"],
    ["工具", "路径迁移", "migrate"],
    [null, "设置", "settings"],
  ] as const) {
    it(`selects ${action} after closing the menu and restoring trigger focus`, async () => {
      const menu = createMenu();
      await menu.open();
      if (group) {
        fire(menu.button(group));
        await Vue.nextTick();
      }
      await fire(menu.button(label));
      expect(menu.actions).toEqual([action]);
      await menu.open();
      expect(menu.rootLabels()).toEqual(["文件", "工具", "设置"]);
    });
  }

  for (const [desktop, importing] of [
    [false, false],
    [true, true],
  ] as const) {
    it(`keeps import disabled for desktop=${desktop}, importing=${importing}`, async () => {
      const menu = createMenu(desktop, importing);
      await menu.open();
      await menu.key("ArrowRight");
      expect(focused).toBe(menu.button("扫描文件夹"));
      const item = menu.button(importing ? "正在导入…" : "导入音频文件");
      expect(item.props.disabled).toBe(true);
      await fire(item);
      expect(menu.actions).toEqual([]);
      expect(menu.menu()).toBeDefined();
      menu.props.canImport = true;
      menu.props.isImporting = false;
      await Vue.nextTick();
      expect(menu.button("导入音频文件").props.disabled).toBe(false);
    });
  }

  it("supports arrow navigation, Home/End, wrapping, and returning from submenus", async () => {
    const menu = createMenu();
    fire(menu.button("NewBee"), "onKeydown", { key: "ArrowDown" });
    await Vue.nextTick();
    expect(focused).toBe(menu.button("文件"));
    await menu.key("ArrowRight");
    expect(focused).toBe(menu.button("导入音频文件"));
    await menu.key("ArrowDown");
    expect(focused).toBe(menu.button("扫描文件夹"));
    await menu.key("ArrowDown");
    expect(focused).toBe(menu.button("导入音频文件"));
    await menu.key("ArrowUp");
    expect(focused).toBe(menu.button("扫描文件夹"));
    await menu.key("Home");
    expect(focused).toBe(menu.button("导入音频文件"));
    await menu.key("End");
    expect(focused).toBe(menu.button("扫描文件夹"));
    await menu.key("ArrowLeft");
    expect(focused).toBe(menu.button("文件"));
    await menu.key("ArrowDown");
    expect(focused).toBe(menu.button("工具"));
    await menu.key("ArrowRight");
    expect(focused).toBe(menu.button("路径迁移"));
    await menu.key("Escape");
    expect(focused).toBe(menu.button("工具"));
    await menu.key("Escape");
    expect(focused).toBe(menu.button("NewBee"));
    expect(findNode(menu.root, (node) => node.props.id === "brand-menu")).toBeNull();
  });

  it("opens on ArrowUp at the last item and closes on Tab or focus leaving the menu", async () => {
    const menu = createMenu();
    fire(menu.button("NewBee"), "onKeydown", { key: "ArrowUp" });
    await Vue.nextTick();
    expect(focused).toBe(menu.button("设置"));
    await menu.key("ArrowDown");
    expect(focused).toBe(menu.button("文件"));
    await menu.key("Tab");
    expect(findNode(menu.root, (node) => node.props.id === "brand-menu")).toBeNull();
    await menu.open();
    fire(menu.button("NewBee").parent!, "onFocusout", { relatedTarget: new MenuNode("button") });
    await Vue.nextTick();
    expect(findNode(menu.root, (node) => node.props.id === "brand-menu")).toBeNull();
  });

  it("ignores inside clicks, closes on outside clicks, and restores focus on document Escape", async () => {
    const menu = createMenu();
    await menu.open();
    dispatchPointer(menu.document, menu.button("文件"));
    await Vue.nextTick();
    expect(menu.menu()).toBeDefined();
    dispatchPointer(menu.document, new MenuNode("outside"));
    await Vue.nextTick();
    expect(findNode(menu.root, (node) => node.props.id === "brand-menu")).toBeNull();
    await menu.open();
    const event = new Event("keydown", { cancelable: true });
    Object.defineProperty(event, "key", { value: "Escape" });
    menu.document.dispatchEvent(event);
    await Vue.nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(focused).toBe(menu.button("NewBee"));
    expect(findNode(menu.root, (node) => node.props.id === "brand-menu")).toBeNull();
  });
});

it("updates open menu groups, actions and status when the language changes", async () => {
  const menu = createMenu(true, true);
  await menu.open();
  fire(menu.button("文件"));
  await Vue.nextTick();
  expect(menu.button("正在导入…").props.disabled).toBe(true);
  setLocale("en");
  await Vue.nextTick();
  expect(menu.rootLabels()).toEqual(["File", "Tools", "Settings"]);
  expect(menu.button("Importing…").props.disabled).toBe(true);
  expect(menu.button("Scan folder")).toBeDefined();
  expect(menu.menu().props["aria-label"]).toBe("NewBee menu");
  setLocale("zh-CN");
  await Vue.nextTick();
  expect(menu.rootLabels()).toEqual(["文件", "工具", "设置"]);
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { useContextMenu } from "@/shared/interaction/useContextMenu";
import { createHostRenderer, findNode, removeNode } from "../../support/host/renderer";

class MenuNode extends EventTarget {
  props: Record<string, unknown> = {};
  children: MenuNode[] = [];
  parent: MenuNode | null = null;
  text = "";
  isConnected = true;
  tabIndex = 0;

  constructor(readonly type: string) {
    super();
  }

  focus(options?: FocusOptions) {
    documentTarget.activeElement = this;
    focusCalls.push({ node: this, options, style: this.closest('[role="menu"]')?.props.style });
  }

  getBoundingClientRect() {
    return { width: 120, height: 80 };
  }

  contains(target: MenuNode): boolean {
    return this === target || this.children.some((child) => child.contains(target));
  }

  closest(selector: string): MenuNode | null {
    if (selector !== '[role="menu"]') throw new Error(`Unexpected selector: ${selector}`);
    return this.props.role === "menu" ? this : (this.parent?.closest(selector) ?? null);
  }

  querySelectorAll(selector: string): MenuNode[] {
    if (selector !== '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])') {
      throw new Error(`Unexpected selector: ${selector}`);
    }
    return this.children.flatMap((child) => [
      ...(child.props.role === "menuitem" &&
      !child.props.disabled &&
      child.props["aria-disabled"] !== "true"
        ? [child]
        : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

class MenuDocument extends EventTarget {
  activeElement: MenuNode | null = null;
}

type Item = { id: string; disabled?: boolean; ariaDisabled?: string; submenu?: Item[] };
const mountedApps: Array<{ unmount: () => void }> = [];
const focusCalls: Array<{ node: MenuNode; options?: FocusOptions; style: unknown }> = [];
const globalNames = ["document", "window", "Node", "innerWidth", "innerHeight"] as const;
const originalGlobals = globalNames.map((name) =>
  Object.getOwnPropertyDescriptor(globalThis, name),
);
let documentTarget: MenuDocument;
let windowTarget: EventTarget;

beforeEach(() => {
  documentTarget = new MenuDocument();
  windowTarget = new EventTarget();
  focusCalls.length = 0;
  for (const [name, value] of Object.entries({
    document: documentTarget,
    window: windowTarget,
    Node: MenuNode,
    innerWidth: 500,
    innerHeight: 300,
  })) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
});

afterEach(async () => {
  for (const app of mountedApps.splice(0)) app.unmount();
  await settle();
  globalNames.forEach((name, index) => {
    const descriptor = originalGlobals[index];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  });
});

async function settle() {
  await Vue.nextTick();
  await Vue.nextTick();
}

function fixture(initialItems: Item[]) {
  const root = new MenuNode("root");
  const items = Vue.ref(initialItems);
  const menuElement = Vue.shallowRef<HTMLElement | null>(null);
  const triggerElement = Vue.shallowRef<HTMLElement | null>(null);
  const fallbackFocusElement = Vue.shallowRef<HTMLElement | null>(null);
  let controller: ReturnType<typeof useContextMenu<string>> | undefined;
  const renderer = createHostRenderer((type) => new MenuNode(type), {
    remove: (node) => {
      removeNode(node);
      node.isConnected = false;
    },
  });
  function renderItems(entries: Item[]): Vue.VNode[] {
    return entries.map((item) =>
      Vue.h("div", { key: item.id }, [
        Vue.h("button", {
          role: "menuitem",
          id: item.id,
          disabled: item.disabled,
          "aria-disabled": item.ariaDisabled,
        }),
        ...(item.submenu ? [Vue.h("div", { role: "menu" }, renderItems(item.submenu))] : []),
      ]),
    );
  }
  const app = renderer.createApp({
    setup() {
      const menu = useContextMenu<string>({ menuElement, fallbackFocusElement });
      controller = menu;
      return () =>
        Vue.h("div", [
          Vue.h("button", { id: "trigger", ref: triggerElement }),
          Vue.h("button", { id: "fallback", ref: fallbackFocusElement }),
          menu.request.value
            ? Vue.h(
                "div",
                {
                  key: menu.request.value.payload,
                  ref: menuElement,
                  role: "menu",
                  style: { left: `${menu.position.value.x}px`, top: `${menu.position.value.y}px` },
                },
                renderItems(items.value),
              )
            : null,
        ]);
    },
  });
  app.mount(root);
  mountedApps.push(app);
  if (!controller) throw new Error("Missing menu controller");
  const menu = controller;
  function node(id: string) {
    const found = findNode(root, (candidate) => candidate.props.id === id);
    if (!found) throw new Error(`Missing item: ${id}`);
    return found;
  }
  function container() {
    const found = findNode(root, (candidate) => candidate.props.role === "menu");
    if (!found) throw new Error("Missing menu container");
    return found;
  }
  function open(payload = "first", x = 490, y = 290) {
    const trigger = triggerElement.value;
    if (!trigger) throw new Error("Missing trigger element");
    menu.open({ x, y, payload, trigger });
  }
  return {
    menu,
    app,
    root,
    trigger: node("trigger"),
    fallback: node("fallback"),
    items,
    node,
    container,
    open,
  };
}

function dispatch(target: EventTarget, type: string, eventTarget?: MenuNode, key?: string) {
  const event = new Event(type, { cancelable: true });
  if (eventTarget) Object.defineProperty(event, "target", { value: eventTarget });
  if (key) Object.defineProperty(event, "key", { value: key });
  target.dispatchEvent(event);
  return event;
}

describe("context menu opening focus", () => {
  it("focuses the first available item in DOM order after rendering the clamped position", async () => {
    const menu = fixture([{ id: "first" }, { id: "second" }]);
    menu.trigger.focus();
    focusCalls.length = 0;
    menu.open();
    expect(documentTarget.activeElement).toBe(menu.trigger);
    expect(menu.menu.position.value).toEqual({ x: 490, y: 290 });
    await settle();
    expect(documentTarget.activeElement).toBe(menu.node("first"));
    expect(menu.menu.position.value).toEqual({ x: 380, y: 220 });
    expect(focusCalls).toEqual([
      {
        node: menu.node("first"),
        options: { preventScroll: true },
        style: { left: "380px", top: "220px" },
      },
    ]);
    expect(menu.container().tabIndex).toBe(-1);
  });

  it("skips native-disabled and aria-disabled items", async () => {
    const menu = fixture([
      { id: "disabled", disabled: true },
      { id: "aria-disabled", ariaDisabled: "true" },
      { id: "available", ariaDisabled: "false" },
      { id: "last" },
    ]);
    menu.open();
    await settle();
    expect(documentTarget.activeElement).toBe(menu.node("available"));
  });

  it("does not take items belonging to an independent submenu", async () => {
    const menu = fixture([
      { id: "disabled-parent", disabled: true, submenu: [{ id: "child" }] },
      { id: "parent" },
    ]);
    menu.open();
    await settle();
    expect(documentTarget.activeElement).toBe(menu.node("parent"));
  });

  for (const [name, items] of [
    ["empty", []],
    ["all disabled", [{ id: "disabled", disabled: true }]],
    [
      "only a submenu item available",
      [{ id: "disabled", disabled: true, submenu: [{ id: "child" }] }],
    ],
  ] satisfies Array<[string, Item[]]>) {
    it(`focuses the programmatically focusable container when ${name}`, async () => {
      const menu = fixture(items);
      menu.trigger.focus();
      menu.open();
      await settle();
      expect(documentTarget.activeElement).toBe(menu.container());
      expect(menu.container().tabIndex).toBe(-1);
      expect(focusCalls[focusCalls.length - 1]?.options).toEqual({ preventScroll: true });
    });
  }

  it("focuses only the latest request during rapid reopening between render ticks", async () => {
    const menu = fixture([{ id: "first" }]);
    menu.open();
    await Vue.nextTick();
    const previous = menu.node("first");
    menu.items.value = [{ id: "latest" }];
    menu.open("latest", 10, 20);
    menu.open("latest", 30, 40);
    await settle();
    expect(focusCalls.map((call) => call.node)).toEqual([menu.node("latest")]);
    expect(documentTarget.activeElement).not.toBe(previous);
    expect(menu.menu.position.value).toEqual({ x: 30, y: 40 });
  });

  for (const action of ["close", "unmount"] as const) {
    for (const phase of ["before rendering", "after positioning"] as const) {
      it(`prevents late focus on ${action} ${phase}`, async () => {
        const menu = fixture([{ id: "first" }]);
        menu.trigger.focus();
        focusCalls.length = 0;
        menu.open();
        if (phase === "after positioning") await Vue.nextTick();
        if (action === "close") menu.menu.close();
        else menu.app.unmount();
        await settle();
        expect(focusCalls).toHaveLength(0);
        expect(documentTarget.activeElement).toBe(menu.trigger);
        expect(menu.menu.request.value).toBeNull();
      });
    }
  }

  it("does not refocus when disabled state or rendered items change after opening", async () => {
    const menu = fixture([{ id: "first" }, { id: "second" }]);
    menu.open();
    await settle();
    menu.node("second").focus();
    focusCalls.length = 0;
    menu.items.value = [{ id: "new" }, { id: "first", disabled: true }, { id: "second" }];
    await settle();
    expect(documentTarget.activeElement).toBe(menu.node("second"));
    expect(focusCalls).toHaveLength(0);
  });
});

describe("context menu closing focus", () => {
  it("restores the connected trigger on Escape", async () => {
    const menu = fixture([{ id: "first" }]);
    menu.open();
    await settle();
    const event = dispatch(documentTarget, "keydown", undefined, "Escape");
    expect(event.defaultPrevented).toBe(true);
    await settle();
    expect(menu.menu.request.value).toBeNull();
    expect(documentTarget.activeElement).toBe(menu.trigger);
    expect(focusCalls[focusCalls.length - 1]?.options).toEqual({ preventScroll: true });
  });

  it("restores the fallback when the trigger was removed, but never a disconnected fallback", async () => {
    const menu = fixture([{ id: "first" }]);
    menu.open();
    await settle();
    menu.trigger.isConnected = false;
    menu.menu.close(true);
    await settle();
    expect(documentTarget.activeElement).toBe(menu.fallback);
    menu.open();
    await settle();
    menu.fallback.isConnected = false;
    focusCalls.length = 0;
    menu.menu.close(true);
    await settle();
    expect(focusCalls).toHaveLength(0);
  });

  it("does not let queued focus restoration steal focus from a reopened menu", async () => {
    const menu = fixture([{ id: "first" }]);
    menu.open();
    await settle();
    focusCalls.length = 0;
    menu.menu.close(true);
    menu.open("latest");
    await settle();
    expect(focusCalls.map((call) => call.node)).toEqual([menu.node("first")]);
    expect(documentTarget.activeElement).toBe(menu.node("first"));
  });

  it("keeps inside pointer and scroll events open, and closes outside without restoration", async () => {
    const menu = fixture([{ id: "first" }]);
    menu.open();
    await settle();
    dispatch(documentTarget, "pointerdown", menu.node("first"));
    dispatch(documentTarget, "scroll", menu.node("first"));
    expect(menu.menu.request.value).not.toBeNull();
    focusCalls.length = 0;
    dispatch(documentTarget, "pointerdown", menu.trigger);
    await settle();
    expect(menu.menu.request.value).toBeNull();
    expect(focusCalls).toHaveLength(0);
    menu.open();
    await settle();
    focusCalls.length = 0;
    dispatch(windowTarget, "scroll", menu.trigger);
    await settle();
    expect(menu.menu.request.value).toBeNull();
    expect(focusCalls).toHaveLength(0);
  });
});

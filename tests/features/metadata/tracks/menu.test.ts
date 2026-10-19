import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostRenderer,
  findNode,
  getTextContent,
  visit,
} from "../../../support/host/renderer";

let focused: MenuNode | null = null;
class MenuNode {
  props: Record<string, unknown> = {};
  children: MenuNode[] = [];
  parent: MenuNode | null = null;
  constructor(
    public type: string,
    public text = "",
  ) {}
  focus() {
    focused = Vue.toRaw(this);
  }
  contains(target: MenuNode): boolean {
    return target === this || this.children.some((child) => child.contains(target));
  }
  getBoundingClientRect() {
    return this.props.role === "menu"
      ? { left: 0, top: 0, right: 224, bottom: 120, width: 224, height: 120 }
      : { left: 750, top: 550, right: 974, bottom: 590, width: 224, height: 40 };
  }
  querySelectorAll(): MenuNode[] {
    const items: MenuNode[] = [];
    visit<MenuNode>(this, (node) => {
      if (node.props.role === "menuitem" && !node.props.disabled) items.push(node);
    });
    return items;
  }
}
const globals = new Map(
  ["Node", "innerWidth", "innerHeight"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
let app: Vue.App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  focused = null;
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
const source = await Bun.file("src/features/metadata/tracks/UpdateMenuItem.vue").text();
const component = evaluateSource<{ default: Vue.Component }>(
  compileSfc(source, "UpdateMenuItem.vue"),
  {
    vue: Vue,
    "@lucide/vue": { ChevronRight: Vue.defineComponent({ setup: () => () => null }) },
  },
).default;
function dispatch(node: MenuNode, name: string, extras: Record<string, unknown> = {}) {
  let prevented = false;
  let stopped = false;
  (node.props[name] as (event: unknown) => void)({
    target: node,
    currentTarget: node,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    ...extras,
  });
  return { prevented, stopped };
}
function mount(disabled = false) {
  for (const [key, value] of Object.entries({
    Node: MenuNode,
    innerWidth: 1000,
    innerHeight: 600,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const state = Vue.reactive({ disabled, visible: true });
  const calls: string[] = [];
  const root = new MenuNode("root");
  app = createHostRenderer((type, text) => new MenuNode(type, text)).createApp({
    setup: () => () =>
      state.visible
        ? Vue.h(
            component,
            { disabled: state.disabled },
            {
              default: () =>
                ["更新缺少的歌词", "分析响度", "重新读取标签"].map((label, index) =>
                  Vue.h(
                    "button",
                    {
                      role: "menuitem",
                      disabled: index === 0,
                      onClick: () => {
                        calls.push(label);
                        state.visible = false;
                      },
                    },
                    label,
                  ),
                ),
            },
          )
        : null,
  });
  app.mount(root);
  const trigger = findNode(root, (node) => node.props["aria-haspopup"] === "menu")!;
  const wrapper = trigger.parent!;
  const menu = () => findNode(root, (node) => node.props.role === "menu");
  return { root, state, calls, trigger, wrapper, menu };
}
it("keeps actions in a hover submenu and flips/clamps it to the viewport", async () => {
  const context = mount();
  expect(context.menu()).toBeNull();
  dispatch(context.trigger, "onMouseenter");
  await Vue.nextTick();
  await Vue.nextTick();
  expect(context.menu()?.props.style).toEqual({ left: "526px", top: "480px" });
  expect(context.trigger.props["aria-expanded"]).toBe(true);
  expect(context.trigger.props["aria-controls"]).toBe(context.menu()?.props.id);
  expect(getTextContent(context.menu()!)).toBe("更新缺少的歌词分析响度重新读取标签");
  dispatch(context.wrapper, "onPointerleave");
  await Vue.nextTick();
  expect(context.menu()).toBeNull();
});
it("opens with Right and returns focus with Left or Escape without closing the parent", async () => {
  const context = mount();
  for (const key of ["ArrowLeft", "Escape"]) {
    dispatch(context.trigger, "onKeydown", { key: "ArrowRight" });
    await Vue.nextTick();
    await Vue.nextTick();
    expect(focused && getTextContent(focused)).toBe("分析响度");
    expect(dispatch(context.wrapper, "onKeydown", { key })).toEqual({
      prevented: true,
      stopped: true,
    });
    await Vue.nextTick();
    expect(context.menu()).toBeNull();
    expect(focused).toBe(context.trigger);
  }
});
it("retains focus inside the submenu, closes on focus departure, and respects disabled state", async () => {
  const context = mount();
  dispatch(context.trigger, "onClick");
  await Vue.nextTick();
  await Vue.nextTick();
  dispatch(context.wrapper, "onFocusout", { relatedTarget: focused });
  await Vue.nextTick();
  expect(context.menu()).not.toBeNull();
  dispatch(context.wrapper, "onFocusout", { relatedTarget: new MenuNode("button") });
  await Vue.nextTick();
  expect(context.menu()).toBeNull();
  context.state.disabled = true;
  await Vue.nextTick();
  dispatch(context.trigger, "onMouseenter");
  await Vue.nextTick();
  expect(context.menu()).toBeNull();
  expect(context.trigger.props.disabled).toBe(true);
});
it("lets the original action close the parent menu", async () => {
  const context = mount();
  dispatch(context.trigger, "onMouseenter");
  await Vue.nextTick();
  await Vue.nextTick();
  dispatch(
    findNode(
      context.root,
      (node) => node.type === "button" && getTextContent(node) === "分析响度",
    )!,
    "onClick",
  );
  await Vue.nextTick();
  expect(context.calls).toEqual(["分析响度"]);
  expect(context.menu()).toBeNull();
});

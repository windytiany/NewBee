import { afterEach, describe, expect, it, mock } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import { DEFAULT_SHORTCUTS } from "@/features/shortcuts/bindings";
import type { ShortcutAction } from "@/features/shortcuts/bindings";
import type { ContextCommands } from "@/features/shortcuts/context";
import { setLocale } from "@/shared/i18n/locale";
import { SHORTCUT_GROUPS } from "@/features/shortcuts/groups";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/host/renderer";

const source = await Bun.file(
  new URL("../../../src/features/shortcuts/CommandDialog.vue", import.meta.url),
).text();
const output = compileSfc(source, "CommandDialog.vue", { inlineTemplate: false });
const originals = new Map(
  ["document", "HTMLElement"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
afterEach(() => {
  setLocale("zh-CN");
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
class Trigger {
  isConnected = true;
  focus = mock(() => {});
}
type Bindings = {
  dialog: Vue.Ref<{
    open: boolean;
    showModal: () => void;
    close: () => void;
    querySelector: () => { scrollIntoView: () => void };
  }>;
  input: Vue.Ref<{ focus: () => void }>;
  actions: Vue.ComputedRef<ShortcutAction[]>;
  query: Vue.Ref<string>;
  selected: Vue.Ref<number>;
  mode: Vue.Ref<"commands" | "shortcuts">;
  available: (action: ShortcutAction) => boolean;
  show: (mode?: "commands" | "shortcuts") => Promise<void>;
  close: () => void;
  restoreFocus: () => void;
  execute: (action: ShortcutAction) => Promise<void>;
  onKeydown: (event: KeyboardEvent) => void;
};
function setup(context: ContextCommands = {}) {
  const trigger = new Trigger();
  const feedback: unknown[] = [];
  const run = mock(async (action: ShortcutAction, context?: ContextCommands) => {
    void action;
    void context;
  });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Trigger });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      activeElement: trigger,
      documentElement: { lang: "zh-CN" },
      querySelector: () => null,
    },
  });
  const component = evaluateSource<{
    default: { setup: (props: object, context: object) => Bindings };
  }>(output, {
    vue: Vue,
    "@lucide/vue": { X: Vue.defineComponent(() => () => Vue.h("svg", { "aria-hidden": "true" })) },
    "@/features/shortcuts/context": { getContextCommands: () => context },
    "@/shared/notifications/center": { notify: (value: unknown) => feedback.push(value) },
  }).default;
  const bindings = component.setup({ bindings: DEFAULT_SHORTCUTS, run }, { expose() {} });
  bindings.dialog.value = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    querySelector: () => ({ scrollIntoView() {} }),
  };
  const focus = mock(() => {});
  bindings.input.value = { focus };
  function press(key: string, composing = false) {
    const preventDefault = mock(() => {});
    bindings.onKeydown({
      key,
      isComposing: composing,
      target: bindings.input.value,
      preventDefault,
    } as unknown as KeyboardEvent);
    return preventDefault;
  }
  return { bindings, trigger, run, feedback, focus, press };
}

describe("command palette", () => {
  it("renders an icon-only close button and the shared shortcut groups in overview", async () => {
    setup();
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(source, "CommandDialog.vue"),
      {
        vue: { ...Vue, vModelText: {} },
        "@lucide/vue": {
          X: Vue.defineComponent(() => () => Vue.h("svg", { "aria-hidden": "true" })),
        },
        "@/features/shortcuts/context": { getContextCommands: () => ({}) },
        "@/shared/notifications/center": { notify() {} },
      },
    ).default;
    const root = createHostNode("root");
    const app = createHostRenderer<ReturnType<typeof createHostNode>>((type, text) => {
      const node = createHostNode(type, text);
      return Object.assign(node, {
        focus() {},
        showModal() {
          Reflect.set(node, "open", true);
        },
        close() {
          Reflect.set(node, "open", false);
        },
      });
    }).createApp(component, { bindings: DEFAULT_SHORTCUTS, run: async () => {} });
    const dialog = app.mount(root) as unknown as {
      show: (mode: "commands" | "shortcuts") => Promise<void>;
    };
    try {
      expect(String(findNode(root, (node) => node.type === "dialog")?.props.class)).toContain(
        "sidebar-scrollbars",
      );
      const header = findNode(root, (node) => node.type === "header");
      const close = header && findNode(header, (node) => node.type === "button");
      expect(close?.props["aria-label"]).toBe("关闭");
      expect(getTextContent(close!)).toBe("");
      expect(findNode(close!, (node) => node.type === "svg")).not.toBeNull();
      await dialog.show("shortcuts");
      for (const group of SHORTCUT_GROUPS) {
        const section = findNode(root, (node) => node.props["data-shortcut-group"] === group.id);
        if (!section) throw new Error(`Missing shortcut group: ${group.id}`);
        const heading = findNode(section, (node) => node.type === "h3");
        expect(getTextContent(heading!)).toBe(group.label);
        for (const action of group.actions)
          expect(
            findNode(section, (node) => node.props["data-shortcut-action"] === action),
          ).not.toBeNull();
        for (const [key, label] of group.keys ?? []) {
          expect(getTextContent(section)).toContain(key);
          expect(getTextContent(section)).toContain(label);
        }
      }
      const element = findNode(root, (node) => node.type === "dialog");
      if (!element || typeof element.props.onClick !== "function")
        throw new Error("Missing dialog backdrop handler");
      for (const mode of ["shortcuts", "commands"] as const) {
        if (mode === "commands") await dialog.show(mode);
        element.props.onClick({ target: header, currentTarget: element });
        expect(Reflect.get(element, "open")).toBe(true);
        element.props.onClick({ target: element, currentTarget: element });
        expect(Reflect.get(element, "open")).toBe(false);
      }
    } finally {
      app.unmount();
    }
  });
  it("opens with input focus, filters action names, navigates and runs the selected command", async () => {
    const { bindings, trigger, run, focus, press } = setup();
    await bindings.show();
    expect(bindings.dialog.value.open).toBe(true);
    expect(focus).toHaveBeenCalled();
    bindings.query.value = "音量";
    expect(bindings.actions.value).toEqual(["volumeDown", "volumeUp"]);
    expect(press("ArrowDown")).toHaveBeenCalled();
    expect(bindings.selected.value).toBe(1);
    press("Enter");
    await Vue.nextTick();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith("volumeUp", {});
    expect(bindings.dialog.value.open).toBe(false);
    expect(trigger.focus).toHaveBeenCalled();
  });

  it("captures list commands, disables unavailable context actions and ignores IME Enter", async () => {
    const context = { addToQueue: mock(() => {}) };
    const { bindings, run, press } = setup(context);
    await bindings.show();
    expect(bindings.available("addToQueue")).toBe(true);
    bindings.query.value = "添加到队尾";
    press("Enter", true);
    expect(run).not.toHaveBeenCalled();
    await bindings.execute("addToQueue");
    expect(run).toHaveBeenCalledWith("addToQueue", context);
    const unavailable = setup();
    await unavailable.bindings.show();
    expect(unavailable.bindings.available("addToQueue")).toBe(false);
    await unavailable.bindings.execute("addToQueue");
    expect(unavailable.run).not.toHaveBeenCalled();
  });

  it("handles no results, localized matching, overview mode and execution errors", async () => {
    const { bindings, run, feedback, press } = setup();
    await bindings.show("shortcuts");
    expect(bindings.mode.value).toBe("shortcuts");
    expect(press("ArrowDown")).not.toHaveBeenCalled();
    bindings.close();
    await bindings.show();
    bindings.query.value = "not a command";
    expect(bindings.actions.value).toEqual([]);
    press("Enter");
    expect(run).not.toHaveBeenCalled();
    setLocale("en");
    bindings.query.value = "volume";
    expect(bindings.actions.value).toEqual(["volumeDown", "volumeUp"]);
    run.mockImplementation(async () => {
      throw new Error("failed");
    });
    await bindings.execute("volumeUp");
    expect(feedback).toHaveLength(1);
  });
});

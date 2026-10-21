import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../module/loader";
import { createHostNode, createHostRenderer, findNode, getTextContent } from "../host/renderer";
import type { HostNode } from "../host/renderer";
import type { Settings } from "@/features/settings/types";
import { cloneShortcuts, DEFAULT_SHORTCUTS } from "@/features/shortcuts/bindings";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { NotificationInput } from "@/shared/notifications/center";
import * as AccentColor from "@/features/settings/appearance/accent";
import { defaults, icons, source, filename, cleanupEditor } from "./editor";
const cleanup: (() => void)[] = [];
export function cleanupView() {
  for (const unmount of cleanup.splice(0)) unmount();
  cleanupEditor();
}
export async function createView() {
  const saved: Settings[] = [];
  const suspensions: boolean[] = [];
  const feedback: NotificationInput[] = [];
  const state = {
    failSave: false,
    persisted: { ...defaults, shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS) },
  };
  const events: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: (event: Event) => events.push(event.type) },
  });
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@lucide/vue": icons,
    "@/shared/notifications/center": {
      notify: (input: NotificationInput) => feedback.push(input),
    },
    "@/features/settings/AboutPanel.vue": Vue.defineComponent({
      setup: () => () => Vue.h("div", { "data-about": "" }, "NewBee"),
    }),
    "@/shared/update/UpdatePanel.vue": Vue.defineComponent({
      setup: () => () => Vue.h("section", { "data-update": "" }, "检查更新"),
    }),
    "@/features/backup/BackupOptions.vue": Vue.defineComponent({
      setup: () => () => Vue.h("button", { type: "button" }, "导出备份"),
    }),
    "@/features/library/synchronization/SynchronizationOptions.vue": Vue.defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          Vue.h("div", slots.heading?.()),
    }),
    "@tauri-apps/api/core": {
      invoke: async (command: string, args?: { settings: Settings; suspended: boolean }) => {
        if (command === "set_shortcuts_suspended" && args) suspensions.push(args.suspended);
        if (command === "get_settings") return state.persisted;
        if (command === "save_settings" && args) {
          if (state.failSave) throw "Shortcut already registered";
          saved.push(args.settings);
          state.persisted = args.settings;
        }
      },
      isTauri: () => true,
    },
    "@/features/settings/events": { SETTINGS_CHANGED_EVENT },
    "@/features/settings/appearance/accent": AccentColor,
    "@/features/settings/appearance/apply": { applyAppearance: () => {} },
  };
  const component = evaluateSource<{ default: Vue.Component }>(
    compileSfc(source, filename),
    modules,
  ).default;
  const renderer = createHostRenderer<HostNode>(
    (type, text = "") => {
      const node = Object.assign(createHostNode(type, text), {
        open: false,
        value: "",
        checked: false,
        selected: false,
        tagName: type.toUpperCase(),
        addEventListener: (event: string, handler: (event: unknown) => void) => {
          node.props[`native-${event}`] = handler;
        },
        removeEventListener: () => {},
        getRootNode: () => ({ activeElement: null }),
        focus() {},
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
        },
      });
      Object.defineProperty(node, "options", {
        get: () => node.children.filter((child) => child.type === "option"),
      });
      return node;
    },
    {
      patchProp(node, key, _previous, next) {
        node.props[key] = next;
        if (key === "value") Object.assign(node, { value: next, _value: next });
      },
    },
  );
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "Document");
  const originalShadowRoot = Object.getOwnPropertyDescriptor(globalThis, "ShadowRoot");
  Object.defineProperty(globalThis, "Document", { configurable: true, value: class Document {} });
  Object.defineProperty(globalThis, "ShadowRoot", {
    configurable: true,
    value: class ShadowRoot {},
  });
  const root = createHostNode("root");
  const app = renderer.createApp(component);
  const dialog = app.mount(root) as unknown as { show: () => Promise<void> };
  cleanup.push(() => {
    app.unmount();
    if (originalDocument) Object.defineProperty(globalThis, "Document", originalDocument);
    else Reflect.deleteProperty(globalThis, "Document");
    if (originalShadowRoot) Object.defineProperty(globalThis, "ShadowRoot", originalShadowRoot);
    else Reflect.deleteProperty(globalThis, "ShadowRoot");
  });
  await dialog.show();
  await Vue.nextTick();
  const header = findNode(root, (node) => node.type === "header")!;
  const footer = findNode(root, (node) => node.type === "footer")!;
  const panel = findNode(root, (node) => node.props.id === "settings-category-panel")!;
  const navigation = findNode(root, (node) => node.props["aria-label"] === "设置分类")!;
  const categoryButtons = navigation.children.filter((node) => node.type === "button");
  async function select(category: string) {
    const button = categoryButtons.find((node) => getTextContent(node).trim() === category);
    if (!button || typeof button.props.onClick !== "function")
      throw new Error(`Missing category ${category}`);
    button.props.onClick();
    await Vue.nextTick();
  }
  return {
    root,
    header,
    footer,
    panel,
    navigation,
    categoryButtons,
    select,
    saved,
    suspensions,
    feedback,
    events,
    state,
    dialog,
    app,
  };
}

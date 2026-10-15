import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import * as Icons from "@lucide/vue";
import { compileSfc, evaluateSource } from "../../support/module/loader";

import { createHostRenderer } from "../../support/host/renderer";
import { notifications } from "@/shared/notifications/center";

class TestElement {
  props: Record<string, unknown> = {};
  children: TestElement[] = [];
  parent: TestElement | null = null;
  text = "";
  open = false;
  focusCalls = 0;
  constructor(public type: string) {}
  get isConnected(): boolean {
    return this === body || (this.parent?.isConnected ?? false);
  }
  contains(node: TestElement | null): boolean {
    return this === node || this.children.some((child) => child.contains(node));
  }
  querySelector(type: string): TestElement | null {
    return find(this, (node) => node !== this && node.type === type);
  }
  focus() {
    documentTarget.activeElement = this;
    this.focusCalls++;
    listeners.get("focusin")?.({ target: this });
  }
}
class TestObserver {
  readonly state: { callback: () => void; disconnected: boolean };
  constructor(callback: () => void) {
    const state = { callback, disconnected: false };
    this.state = state;
    observer = state;
  }
  observe() {}
  disconnect() {
    this.state.disconnected = true;
  }
}
let body: TestElement;
let observer: { callback: () => void; disconnected: boolean } | null;
let documentTarget: { body: TestElement; activeElement: TestElement | null };
const listeners = new Map<string, (event: { target: TestElement }) => void>();
const originals = new Map<string, PropertyDescriptor | undefined>();
const apps: Array<{ unmount: () => void }> = [];

function find(node: TestElement, predicate: (element: TestElement) => boolean): TestElement | null {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}
function append(node: TestElement, parent: TestElement, anchor: TestElement | null = null) {
  if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
  node.parent = parent;
  const index = anchor ? parent.children.indexOf(anchor) : -1;
  if (index < 0) parent.children.push(node);
  else parent.children.splice(index, 0, node);
}

const output = compileSfc(
  await Bun.file(
    new URL("../../../src/shared/notifications/NotificationHost.vue", import.meta.url),
  ).text(),
  "src/shared/notifications/NotificationHost.vue",
  { id: "notification-host-test" },
);
const modules: Record<string, unknown> = {
  vue: Vue,
  "@lucide/vue": Icons,
  "@/shared/notifications/center": { notifications },
};
const NotificationHost = evaluateSource<{ default: Vue.Component }>(output, modules).default;

function mountHost() {
  const renderer = createHostRenderer(
    (type, text = "") => Object.assign(new TestElement(type), { text }),
    { querySelector: () => body },
  );
  const root = new TestElement("root");
  append(root, body);
  const app = renderer.createApp(NotificationHost);
  app.mount(root);
  apps.push(app);
  return app;
}
function host() {
  const element = find(body, (node) => node.props["aria-label"] === "通知");
  if (!element) throw new Error("Notification host is missing");
  return element;
}
function textContent(node: TestElement | null): string {
  if (!node) return "";
  return node.text + node.children.map(textContent).join("");
}
function click(node: TestElement) {
  const handler = node.props.onClick;
  if (typeof handler === "function") handler({ stopPropagation() {} });
}

beforeEach(() => {
  notifications.clear();
  body = new TestElement("body");
  observer = null;
  listeners.clear();
  documentTarget = { body, activeElement: null };
  const document = Object.assign(documentTarget, {
    querySelectorAll: () => {
      const dialogs = body.children.filter((node) => node.type === "dialog" && node.open);
      return { length: dialogs.length, item: (index: number) => dialogs[index] ?? null };
    },
    addEventListener: (type: string, listener: (event: { target: TestElement }) => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
  });
  for (const [key, value] of Object.entries({
    document,
    HTMLElement: TestElement,
    Node: TestElement,
    MutationObserver: TestObserver,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  notifications.clear();
  for (const [key, original] of originals) {
    if (original) Object.defineProperty(globalThis, key, original);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

describe("notification host", () => {
  it("renders persistent progress with cancellation rather than a dismiss button", async () => {
    mountHost();
    let cancelled = 0;
    notifications.updateTask({
      key: "lyrics",
      message: "正在更新缺少的歌词",
      completed: 3,
      total: 10,
      cancelling: false,
      cancel: () => {
        cancelled++;
      },
    });
    try {
      await Vue.nextTick();
      const task = find(host(), (node) => node.props["data-task-notification"] !== undefined);
      if (!task) throw new Error("Missing task notification");
      expect(find(task, (node) => node.type === "progress")?.props.value).toBe(3);
      const button = task.querySelector("button");
      if (!button) throw new Error("Missing cancel button");
      expect(button.props["aria-label"]).not.toBe("关闭通知");
      click(button);
      expect(cancelled).toBe(1);
      notifications.removeTask("lyrics");
      await Vue.nextTick();
      expect(find(host(), (node) => node.props["data-task-notification"] !== undefined)).toBeNull();
    } finally {
      notifications.removeTask("lyrics");
    }
  });

  it("shows indeterminate then measured progress without cancellation", async () => {
    mountHost();
    notifications.updateTask({ key: "scan", message: "正在扫描…", completed: 0 });
    try {
      await Vue.nextTick();
      const task = find(host(), (node) => node.props["data-task-notification"] !== undefined);
      if (!task) throw new Error("Missing scan progress");
      expect(task.querySelector("progress")?.props.value).toBeUndefined();
      expect(task.querySelector("button")).toBeNull();
      notifications.updateTask({ key: "scan", message: "正在扫描…", completed: 4, total: 10 });
      await Vue.nextTick();
      expect(task.querySelector("progress")?.props.value).toBe(4);
      expect(task.querySelector("progress")?.props.max).toBe(10);
      expect(textContent(task)).toContain("已处理 4 / 10");
    } finally {
      notifications.removeTask("scan");
    }
  });

  it("renders accessible dismissable toasts outside the page layout", async () => {
    mountHost();
    notifications.notify({ type: "success", message: "已添加到歌单" });
    notifications.notify({ type: "error", message: "读取失败\n详细信息" });
    await Vue.nextTick();
    expect(host().parent).toBe(body);
    expect(host().props.class).toContain("fixed");
    expect(textContent(find(host(), (node) => node.props.role === "status"))).toContain(
      "已添加到歌单",
    );
    expect(textContent(find(host(), (node) => node.props.role === "alert"))).toContain("详细信息");
    const button = host().querySelector("button");
    if (!button) throw new Error("Dismiss button is missing");
    expect(button.props["aria-label"]).toBe("关闭通知");
    click(button);
    await Vue.nextTick();
    expect(notifications.items.value.map(({ type }) => type)).toEqual(["error"]);
  });

  it("moves the same toast into the active modal and back without dropping it", async () => {
    const dialog = new TestElement("dialog");
    append(dialog, body);
    mountHost();
    const id = notifications.notify({ type: "error", message: "数据库不可用" });
    await Vue.nextTick();
    dialog.open = true;
    observer?.callback();
    await Vue.nextTick();
    expect(host().parent).toBe(dialog);
    expect(notifications.items.value[0].id).toBe(id);
    dialog.open = false;
    observer?.callback();
    await Vue.nextTick();
    expect(host().parent).toBe(body);
    expect(notifications.items.value[0].id).toBe(id);
  });

  it("starts inside an already open modal and restores input focus after keyboard dismissal", async () => {
    const dialog = new TestElement("dialog");
    dialog.open = true;
    append(dialog, body);
    const input = new TestElement("input");
    append(input, dialog);
    mountHost();
    await Vue.nextTick();
    input.focus();
    notifications.notify({ type: "error", message: "歌单名称不能为空。" });
    await Vue.nextTick();
    const button = host().querySelector("button");
    if (!button) throw new Error("Dismiss button is missing");
    button.focus();
    click(button);
    await Vue.nextTick();
    await Vue.nextTick();
    expect(documentTarget.activeElement).toBe(input);
    expect(notifications.items.value).toEqual([]);
  });

  it("disconnects observers, focus listeners and timers on unmount", async () => {
    const app = mountHost();
    notifications.notify({ type: "success", message: "saved" });
    await Vue.nextTick();
    app.unmount();
    expect(observer?.disconnected).toBe(true);
    expect(listeners.size).toBe(0);
    expect(notifications.items.value).toEqual([]);
  });
});

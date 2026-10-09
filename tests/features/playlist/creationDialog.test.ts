import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as Vue from "vue";
import { notifications, notify } from "@/shared/notifications/center";
import { compileSfc, evaluateSource } from "../../support/moduleLoader";
import { createHostRenderer, findNode, getTextContent } from "../../support/hostRenderer";
import type { HostTree } from "../../support/hostRenderer";

class TestDocument {
  activeElement: DialogNode | null = null;
}
class TestShadowRoot extends TestDocument {}

interface DialogNode extends HostTree<DialogNode> {
  type: string;
  value: string;
  open: boolean;
  focusCalls: number;
  listeners: Map<string, Array<(event: Event) => void>>;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
  dispatch: (type: string) => void;
  focus: () => void;
  showModal: () => void;
  close: () => void;
  getRootNode: () => TestDocument;
}

const dialogOutput = compileSfc(
  await Bun.file(
    new URL(
      "../../../src/features/playlist/components/dialogs/CreatePlaylistDialog.vue",
      import.meta.url,
    ),
  ).text(),
  "src/features/playlist/components/dialogs/CreatePlaylistDialog.vue",
);
const originals = new Map(
  ["document", "Document", "ShadowRoot"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
const apps: Vue.App[] = [];
let documentTarget: TestDocument;

function callHandler(node: DialogNode, key: string, event: object = {}) {
  const handler = node.props[key];
  if (typeof handler !== "function") throw new Error(`Missing ${key} on ${node.type}`);
  return handler(event);
}

function createNode(type: string, text = ""): DialogNode {
  const node: DialogNode = {
    type,
    text,
    props: {},
    children: [],
    parent: null,
    value: "",
    open: false,
    focusCalls: 0,
    listeners: new Map(),
    addEventListener(type, listener) {
      const listeners = node.listeners.get(type) ?? [];
      listeners.push(listener);
      node.listeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      node.listeners.set(
        type,
        (node.listeners.get(type) ?? []).filter((item) => item !== listener),
      );
    },
    dispatch(type) {
      const event = new Event(type);
      Object.defineProperty(event, "target", { value: node });
      for (const listener of node.listeners.get(type) ?? []) {
        listener(event);
      }
    },
    focus() {
      node.focusCalls++;
      documentTarget.activeElement = node;
    },
    showModal() {
      node.open = true;
    },
    close() {
      if (!node.open) return;
      node.open = false;
      callHandler(node, "onClose", new Event("close"));
    },
    getRootNode: () => documentTarget,
  };
  return node;
}

function mountDialog(
  backend: (command: string, args: unknown) => Promise<unknown> = async () => 73,
) {
  const invoke = mock(backend);
  const errors = mock(() => {});
  const component = evaluateSource<{ default: Vue.Component }>(dialogOutput, {
    vue: Vue,
    "@/shared/notifications/center": { notify },
    "@tauri-apps/api/core": { invoke },
    "@/shared/logging/logger": { logger: { error: errors } },
  }).default;
  const renderer = createHostRenderer(createNode, {
    patchProp(node, key, _previous, next) {
      node.props[key] = next;
      if (key === "value") node.value = String(next ?? "");
    },
  });
  const root = createNode("root");
  const created: number[] = [];
  const app = renderer.createApp(component, { onCreated: (id: number) => created.push(id) });
  const exposed = app.mount(root);
  apps.push(app);
  if (!("show" in exposed) || typeof exposed.show !== "function") {
    throw new Error("Missing exposed show method");
  }
  const show = exposed.show;
  function required(predicate: (node: DialogNode) => boolean) {
    const node = findNode(root, predicate);
    if (!node) throw new Error("Missing dialog node");
    return node;
  }
  const dialog = required((node) => node.type === "dialog");
  const input = required((node) => node.type === "input");
  const form = required((node) => node.type === "form");
  const cancel = required((node) => node.props.type === "button");
  const confirm = required((node) => node.type === "button" && node.props.type === "submit");
  return {
    invoke,
    errors,
    created,
    dialog,
    input,
    cancel,
    confirm,
    show: (loader?: () => Promise<readonly number[]>) => show(loader),
    setName(value: string) {
      input.value = value;
      input.dispatch("input");
      callHandler(input, "onInput", { target: input });
    },
    async submit() {
      await callHandler(form, "onSubmit", { preventDefault() {} });
      await Vue.nextTick();
    },
    alert: () => {
      const alert = findNode(root, (node) => node.props.role === "alert");
      return alert ? getTextContent(alert) : "";
    },
  };
}

beforeEach(() => {
  notifications.clear();
  documentTarget = new TestDocument();
  for (const [key, value] of Object.entries({
    document: documentTarget,
    Document: TestDocument,
    ShadowRoot: TestShadowRoot,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});

afterEach(() => {
  notifications.clear();
  for (const app of apps.splice(0)) app.unmount();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe("创建歌单对话框", () => {
  it("普通创建只创建歌单，不添加歌曲，并修剪名称", async () => {
    const dialog = mountDialog();
    dialog.show();
    dialog.setName("  My playlist  ");
    await dialog.submit();
    expect(dialog.invoke.mock.calls).toEqual([["create_playlist", { name: "My playlist" }]]);
    expect(dialog.created).toEqual([73]);
    expect(dialog.dialog.open).toBe(false);
    expect(dialog.input.value).toBe("");
  });

  it("提交时加载歌曲，创建后按 loader 顺序逐首添加", async () => {
    const dialog = mountDialog();
    const loader = mock(async () => [41, 12, 29]);
    dialog.show(loader);
    expect(loader).not.toHaveBeenCalled();
    dialog.setName("Album");
    await dialog.submit();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(dialog.invoke.mock.calls).toEqual([
      ["create_playlist", { name: "Album" }],
      ["add_track_to_playlist", { trackId: 41, playlistId: 73 }],
      ["add_track_to_playlist", { trackId: 12, playlistId: 73 }],
      ["add_track_to_playlist", { trackId: 29, playlistId: 73 }],
    ]);
    expect(dialog.created).toEqual([73]);
    expect(dialog.dialog.open).toBe(false);
  });

  it("取消不调用创建或 loader，重新打开清空输入且不沿用歌曲", async () => {
    const dialog = mountDialog();
    const loader = mock(async () => [41]);
    dialog.show(loader);
    dialog.setName("Cancelled");
    callHandler(dialog.cancel, "onClick");
    await Vue.nextTick();
    expect(dialog.dialog.open).toBe(false);
    expect(dialog.invoke).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
    expect(dialog.created).toEqual([]);
    dialog.show();
    await Vue.nextTick();
    expect(dialog.input.value).toBe("");
    dialog.setName("Empty playlist");
    await dialog.submit();
    expect(dialog.invoke.mock.calls).toEqual([["create_playlist", { name: "Empty playlist" }]]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("空白名称通过 toast 校验并聚焦输入，不调用创建或 loader", async () => {
    const dialog = mountDialog();
    const loader = mock(async () => [41]);
    dialog.show(loader);
    dialog.setName(" \t\n ");
    await dialog.submit();
    expect(dialog.invoke).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
    expect(dialog.created).toEqual([]);
    expect(dialog.dialog.open).toBe(true);
    expect(dialog.alert()).toBe("");
    expect(notifications.items.value[0]).toMatchObject({
      type: "warning",
      message: "请输入歌单名称",
    });
    expect(dialog.input.props["aria-invalid"]).toBe(true);
    expect(documentTarget.activeElement).toBe(dialog.input);
    expect(dialog.input.focusCalls).toBe(2);
    dialog.setName("Valid");
    await Vue.nextTick();
    expect(dialog.input.props["aria-invalid"]).toBeUndefined();
    await dialog.submit();
    expect(dialog.created).toEqual([73]);
  });

  it("创建失败保留输入并允许重试，重试使用已经加载的歌曲", async () => {
    let attempts = 0;
    const dialog = mountDialog(async (command) => {
      if (command === "create_playlist" && ++attempts === 1)
        throw new Error("Database unavailable");
      return 73;
    });
    const loader = mock(async () => [41]);
    dialog.show(loader);
    dialog.setName("Retry");
    await dialog.submit();
    expect(dialog.alert()).toBe("");
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "创建歌单失败，请查看日志",
    });
    expect(dialog.dialog.open).toBe(true);
    expect(dialog.input.value).toBe("Retry");
    expect(dialog.input.props.disabled).toBe(false);
    expect(dialog.confirm.props.disabled).toBe(false);
    expect(dialog.created).toEqual([]);
    expect(dialog.errors).toHaveBeenCalledTimes(1);
    await dialog.submit();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(dialog.invoke.mock.calls).toEqual([
      ["create_playlist", { name: "Retry" }],
      ["create_playlist", { name: "Retry" }],
      ["add_track_to_playlist", { trackId: 41, playlistId: 73 }],
    ]);
    expect(dialog.dialog.open).toBe(false);
    expect(dialog.created).toEqual([73]);
  });

  it("部分添加失败保留歌单和成功歌曲，重试仅添加剩余歌曲", async () => {
    const tracks: number[] = [];
    let failed = false;
    const dialog = mountDialog(async (command, args) => {
      if (command === "create_playlist") return 73;
      if (
        !args ||
        typeof args !== "object" ||
        !("trackId" in args) ||
        typeof args.trackId !== "number"
      ) {
        throw new Error("Missing trackId");
      }
      if (args.trackId === 12 && !failed) {
        failed = true;
        throw new Error("Add failed");
      }
      tracks.push(args.trackId);
    });
    const loader = mock(async () => [41, 12, 29]);
    dialog.show(loader);
    dialog.setName("Partial");
    await dialog.submit();
    expect(tracks).toEqual([41]);
    expect(dialog.created).toEqual([73]);
    expect(dialog.alert()).toBe("");
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.message).toContain("歌单已创建，已添加 1 首");
    expect(dialog.dialog.open).toBe(true);
    expect(dialog.input.value).toBe("Partial");
    expect(dialog.input.props.disabled).toBe(true);
    expect(dialog.confirm.props.disabled).toBe(false);
    await dialog.submit();
    expect(tracks).toEqual([41, 12, 29]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(dialog.invoke.mock.calls).toEqual([
      ["create_playlist", { name: "Partial" }],
      ["add_track_to_playlist", { trackId: 41, playlistId: 73 }],
      ["add_track_to_playlist", { trackId: 12, playlistId: 73 }],
      ["add_track_to_playlist", { trackId: 12, playlistId: 73 }],
      ["add_track_to_playlist", { trackId: 29, playlistId: 73 }],
    ]);
    expect(dialog.created).toEqual([73, 73]);
    expect(dialog.dialog.open).toBe(false);
  });

  it("pending 时禁止重复提交、取消、Escape、背景关闭和重新 show", async () => {
    let resolve!: (id: number) => void;
    const pending = new Promise<number>((finish) => {
      resolve = finish;
    });
    const dialog = mountDialog(() => pending);
    const loader = mock(async () => []);
    const replacementLoader = mock(async () => [99]);
    dialog.show(loader);
    dialog.setName("Pending");
    const submission = dialog.submit();
    await Vue.nextTick();
    await dialog.submit();
    callHandler(dialog.cancel, "onClick");
    const preventDefault = mock(() => {});
    callHandler(dialog.dialog, "onCancel", { preventDefault });
    callHandler(dialog.dialog, "onClick", { target: dialog.dialog, currentTarget: dialog.dialog });
    dialog.show(replacementLoader);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(dialog.invoke.mock.calls).toEqual([["create_playlist", { name: "Pending" }]]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(replacementLoader).not.toHaveBeenCalled();
    expect(dialog.dialog.open).toBe(true);
    expect(dialog.input.value).toBe("Pending");
    expect(dialog.input.props.disabled).toBe(true);
    expect(dialog.cancel.props.disabled).toBe(true);
    expect(dialog.confirm.props.disabled).toBe(true);
    expect(getTextContent(dialog.confirm)).toBe("正在创建…");
    expect(dialog.created).toEqual([]);
    resolve(73);
    await submission;
    expect(dialog.created).toEqual([73]);
    expect(dialog.dialog.open).toBe(false);
    expect(dialog.confirm.props.disabled).toBe(false);
  });
});

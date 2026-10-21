import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
  type HostNode,
} from "../../../support/host/renderer";
import { createSynchronization } from "../../../support/library/synchronization";
import { notifications, notify } from "@/shared/notifications/center";
import type { SynchronizationFolder } from "@/features/library/synchronization/types";
import type { IngestResult } from "@/features/library/types";

const output = compileSfc(
  await Bun.file("src/features/library/synchronization/ScanDialog.vue").text(),
  "src/features/library/synchronization/ScanDialog.vue",
);
const folder: SynchronizationFolder = { path: "/Music", mode: "manual", enabled: true };
const unchanged = { added: 0, updated: 0, skipped: 0, failed: 0 };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const apps: Array<{ unmount: () => void }> = [];
beforeEach(() => {
  notifications.clear();
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
});
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  notifications.clear();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function mount(
  invoke: (command: string, args?: { folders: SynchronizationFolder[] }) => Promise<unknown>,
  scan = createSynchronization(async () => unchanged).scan,
  choose = async () => folder.path,
) {
  const icon = Vue.defineComponent({ setup: () => () => Vue.h("svg") });
  const component = evaluateSource<{ default: Vue.Component }>(output, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke, isTauri: () => true },
    "@tauri-apps/plugin-dialog": { open: choose },
    "@lucide/vue": { Minus: icon, Plus: icon },
    "@/features/library/synchronization/useScan": { useLibrarySynchronization: () => scan },
    "@/shared/notifications/center": { notify },
  }).default;
  const renderer = createHostRenderer<HostNode>((type, text = "") =>
    Object.assign(createHostNode(type, text), {
      open: false,
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    }),
  );
  const root = createHostNode("root");
  const exposed = Vue.shallowRef<{ show: () => void } | null>(null);
  const app = renderer.createApp({ setup: () => () => Vue.h(component, { ref: exposed }) });
  app.mount(root);
  apps.push(app);
  exposed.value?.show();
  return {
    root,
    show: () => exposed.value?.show(),
    unmount: () => {
      app.unmount();
      apps.splice(apps.indexOf(app), 1);
    },
  };
}
function button(root: HostNode, label: string) {
  const found = findNode(
    root,
    (node) =>
      node.type === "button" &&
      (node.props["aria-label"] === label || getTextContent(node).trim() === label),
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function click(node: HostNode) {
  if (!node.props.disabled && typeof node.props.onClick === "function") node.props.onClick({});
}
async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Vue.nextTick();
}

describe("synchronization directory dialog", () => {
  for (const [path, display] of [
    [String.raw`\\?\D:\Music`, String.raw`D:\Music`],
    [String.raw`\\?\UNC\server\music`, String.raw`\\server\music`],
    ["/Music", "/Music"],
  ]) {
    it(`presents ${path} without changing the stored path`, async () => {
      const saved = { ...folder, path: path! };
      const dialog = mount(async () => [saved]);
      await settle();
      expect(getTextContent(dialog.root)).toContain(display!);
      expect(saved.path).toBe(path);
    });
  }

  it("uses one mode editor and leaves an empty list unable to scan", async () => {
    const dialog = mount(async () => []);
    await settle();
    expect(button(dialog.root, "扫描").props.disabled).toBe(true);
    expect(button(dialog.root, "关闭")).toBeDefined();
    expect(getTextContent(dialog.root)).toContain("同步文件夹");
    expect(getTextContent(dialog.root)).not.toContain("移除目录不会");
    expect(findNode(dialog.root, (node) => node.props["aria-label"] === "扫描说明")).toBeNull();
  });

  it("persists additions and removals through the same configuration used by settings", async () => {
    let saved: SynchronizationFolder[] = [];
    const calls: string[] = [];
    const dialog = mount(async (command, args) => {
      calls.push(command);
      if (command === "save_synchronization_folders") saved = args!.folders;
      return saved;
    });
    await settle();
    click(button(dialog.root, "添加文件夹"));
    await settle();
    expect(saved).toEqual([folder]);
    expect(getTextContent(dialog.root)).toContain("手动");
    click(button(dialog.root, "移除"));
    await settle();
    expect(saved).toEqual([]);
    expect(calls).toEqual([
      "get_synchronization_folders",
      "save_synchronization_folders",
      "save_synchronization_folders",
    ]);
    expect(notifications.items.value).toEqual([]);
  });

  it("selects an existing folder instead of submitting a duplicate", async () => {
    const calls: string[] = [];
    const dialog = mount(async (command) => {
      calls.push(command);
      return [folder];
    });
    await settle();
    click(button(dialog.root, "添加文件夹"));
    await settle();
    expect(calls).toEqual(["get_synchronization_folders"]);
    expect(notifications.items.value).toEqual([]);
  });

  it("rolls back edits after saving fails", async () => {
    const dialog = mount(
      async (command) => {
        if (command === "get_synchronization_folders") return [folder];
        throw new Error("permission denied");
      },
      undefined,
      async () => "/Other",
    );
    await settle();
    click(button(dialog.root, "添加文件夹"));
    await settle();
    expect(getTextContent(dialog.root)).toContain("/Music");
    expect(getTextContent(dialog.root)).not.toContain("/Other");
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "保存同步文件夹失败",
    });
  });

  it("blocks scanning and editing when configuration could not be read", async () => {
    const dialog = mount(async () => {
      throw new Error("read failed");
    });
    await settle();
    expect(notifications.items.value[0]?.message).toBe("读取同步文件夹失败");
    expect(button(dialog.root, "扫描").props.disabled).toBe(true);
    expect(findNode(dialog.root, (node) => node.type === "fieldset")?.props.disabled).toBe(true);
  });

  it("does not scan disabled folders", async () => {
    const context = createSynchronization(async () => unchanged);
    const dialog = mount(async () => [{ ...folder, enabled: false }], context.scan);
    await settle();
    click(button(dialog.root, "扫描"));
    expect(context.calls).toEqual([]);
  });

  it("closes immediately and keeps the shared operation alive after unmount", async () => {
    let resolve!: (result: IngestResult) => void;
    const context = createSynchronization(
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    const dialog = mount(async () => [folder], context.scan);
    await settle();
    const element = findNode(dialog.root, (node) => node.type === "dialog");
    click(button(dialog.root, "扫描"));
    expect((element as HostNode & { open: boolean })?.open).toBe(false);
    expect(context.scan.isScanning.value).toBe(true);
    dialog.unmount();
    resolve({ ...unchanged, added: 2, updated: 1 });
    await settle();
    expect(context.scan.isScanning.value).toBe(false);
    expect(notifications.items.value[0]).toMatchObject({
      type: "success",
      message: "扫描完成：新增 2 首，更新 1 首",
    });
  });

  it("retains failures after closing and refuses duplicate scans", async () => {
    let reject!: (error: Error) => void;
    const context = createSynchronization(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const dialog = mount(async () => [folder], context.scan);
    await settle();
    click(button(dialog.root, "扫描"));
    dialog.show();
    await settle();
    const scanButton = button(dialog.root, "正在扫描…");
    expect(scanButton.props.disabled).toBe(true);
    click(scanButton);
    expect(context.calls).toHaveLength(1);
    reject(new Error("database unavailable"));
    await settle();
    expect(notifications.items.value).toEqual([]);
    expect(context.tasks.items.value[0]?.result).toMatchObject({
      type: "error",
      message: "database unavailable",
    });
  });
});

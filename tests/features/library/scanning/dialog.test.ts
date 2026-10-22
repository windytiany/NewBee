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
import type { IngestResult } from "@/features/library/types";

const output = compileSfc(
  await Bun.file("src/features/library/scanning/ScanDialog.vue").text(),
  "src/features/library/scanning/ScanDialog.vue",
);
const folder = "/Music";
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
  invoke: (command: string, args?: { folders: string[] }) => Promise<unknown>,
  scan = createSynchronization(async () => unchanged).scan,
  choose = async () => folder,
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

describe("scan directory dialog", () => {
  for (const [path, display] of [
    [String.raw`\\?\D:\Music`, String.raw`D:\Music`],
    [String.raw`\\?\UNC\server\music`, String.raw`\\server\music`],
    ["/Music", "/Music"],
  ]) {
    it(`presents ${path} without changing the stored path`, async () => {
      const saved = path!;
      const dialog = mount(async () => [saved]);
      await settle();
      expect(getTextContent(dialog.root)).toContain(display!);
      expect(saved).toBe(path);
    });
  }

  it("uses a path-only list and leaves an empty list unable to scan", async () => {
    const dialog = mount(async () => []);
    await settle();
    expect(button(dialog.root, "扫描").props.disabled).toBe(true);
    expect(button(dialog.root, "关闭")).toBeDefined();
    expect(getTextContent(dialog.root)).not.toContain("同步文件夹");
    expect(findNode(dialog.root, (node) => node.type === "select")).toBeNull();
    expect(getTextContent(dialog.root)).not.toContain("移除目录不会");
    expect(findNode(dialog.root, (node) => node.props["aria-label"] === "扫描说明")).toBeNull();
  });

  it("persists additions and removals independently of synchronization settings", async () => {
    let saved: string[] = [];
    const calls: string[] = [];
    const dialog = mount(async (command, args) => {
      calls.push(command);
      if (command === "save_scan_folders") saved = args!.folders;
      return saved;
    });
    await settle();
    click(button(dialog.root, "添加文件夹"));
    await settle();
    expect(saved).toEqual([folder]);
    expect(getTextContent(dialog.root)).not.toContain("手动");
    expect(findNode(dialog.root, (node) => node.type === "select")).toBeNull();
    click(button(dialog.root, "移除"));
    await settle();
    expect(saved).toEqual([]);
    expect(calls).toEqual(["get_scan_folders", "save_scan_folders", "save_scan_folders"]);
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
    expect(calls).toEqual(["get_scan_folders"]);
    expect(notifications.items.value).toEqual([]);
  });

  it("rolls back edits after saving fails", async () => {
    const dialog = mount(
      async (command) => {
        if (command === "get_scan_folders") return [folder];
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
      message: "保存扫描文件夹失败",
    });
  });

  it("blocks scanning and editing when configuration could not be read", async () => {
    const dialog = mount(async () => {
      throw new Error("read failed");
    });
    await settle();
    expect(notifications.items.value[0]?.message).toBe("读取扫描文件夹失败");
    expect(button(dialog.root, "扫描").props.disabled).toBe(true);
    expect(findNode(dialog.root, (node) => node.type === "fieldset")?.props.disabled).toBe(true);
  });

  it("scans exactly the listed paths without consulting synchronization modes", async () => {
    const context = createSynchronization(async () => unchanged);
    const dialog = mount(async () => [folder, "/Other"], context.scan);
    await settle();
    click(button(dialog.root, "扫描"));
    await settle();
    expect(context.calls).toHaveLength(1);
    expect(context.calls[0]).toMatchObject({
      command: "scan_library",
      args: { paths: [folder, "/Other"] },
    });
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

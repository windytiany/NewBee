import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileSfc, transpileScript, evaluateSource } from "../../support/moduleLoader";

import { createHostRenderer } from "../../support/hostRenderer";
import { HelpDialog } from "../../support/helpDialog";
import { notifications, notify } from "@/shared/notifications/center";
import type { useLibraryScan } from "@/features/library/import/useScan";
import type { IngestResult } from "@/features/library/types";

class HostNode {
  props: Record<string, unknown> = {};
  children: HostNode[] = [];
  parent: HostNode | null = null;
  text = "";
  open = false;
  constructor(public type: string) {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
}
type Directory = { id: number; path: string; displayPath: string };
const directory: Directory = { id: 1, path: "/Music", displayPath: "/Music" };

const scanOutput = transpileScript(
  await Bun.file(
    new URL("../../../src/features/library/import/useScan.ts", import.meta.url),
  ).text(),
);
const dialogOutput = compileSfc(
  await Bun.file(
    new URL("../../../src/features/library/import/ScanDialog.vue", import.meta.url),
  ).text(),
  "src/features/library/import/ScanDialog.vue",
  { id: "library-scan-dialog-test" },
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const apps: Array<{ unmount: () => void }> = [];
let events: string[];

function createScan(invoke: () => Promise<IngestResult>) {
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@tauri-apps/api/core": { invoke },
    "@/shared/notifications/center": { notify },
    "@/features/library/events": {
      reportLibraryImport: () => {
        globalThis.window.dispatchEvent(new Event("newbee:library-changed"));
      },
    },
  };
  return evaluateSource<{ useLibraryScan: typeof useLibraryScan }>(
    scanOutput,
    modules,
  ).useLibraryScan();
}
function mountDialog(
  scan: ReturnType<typeof useLibraryScan>,
  invoke: (command: string) => Promise<unknown>,
) {
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@tauri-apps/api/core": { invoke, isTauri: () => true },
    "@tauri-apps/plugin-dialog": { open: async () => directory.path },
    "@/features/library/import/useScan": { useLibraryScan: () => scan },
    "@/shared/components/HelpDialog.vue": HelpDialog,
    "@/shared/notifications/center": { notify },
  };
  const component = evaluateSource<{ default: Vue.Component }>(dialogOutput, modules).default;
  const renderer = createHostRenderer((type, text = "") =>
    Object.assign(new HostNode(type), { text }),
  );
  const root = new HostNode("root");
  const dialog = Vue.shallowRef<{ show: () => void } | null>(null);
  const app = renderer.createApp({
    setup: () => () => Vue.h(component, { ref: dialog }),
  });
  app.mount(root);
  apps.push(app);
  dialog.value?.show();
  return {
    root,
    show: () => dialog.value?.show(),
    unmount: () => {
      app.unmount();
      apps.splice(apps.indexOf(app), 1);
    },
  };
}
function find(node: HostNode, predicate: (node: HostNode) => boolean): HostNode | null {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}
function textContent(node: HostNode): string {
  return node.text + node.children.map(textContent).join("");
}
function button(root: HostNode, label: string) {
  const node = find(root, (node) => node.type === "button" && textContent(node).trim() === label);
  if (!node) throw new Error(`Button not rendered: ${label}`);
  return node;
}
function click(node: HostNode) {
  if (node.props.disabled) return;
  const handler = node.props.onClick;
  if (typeof handler === "function") handler();
}
async function settle() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  await Vue.nextTick();
}
function idleScan() {
  return createScan(async () => ({ added: 0, updated: 0, skipped: 0, failed: 0 }));
}
beforeEach(() => {
  notifications.clear();
  events = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        events.push(event.type);
      },
    },
  });
});
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  notifications.clear();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("library scan dialog", () => {
  it("keeps the empty state short and shows scan instructions only on demand", async () => {
    const dialog = mountDialog(idleScan(), async () => []);
    await settle();
    expect(textContent(dialog.root)).toContain("无目录");
    expect(button(dialog.root, "取消")).not.toBeNull();
    expect(
      find(dialog.root, (node) => node.type === "button" && textContent(node).trim() === "关闭"),
    ).toBeNull();
    expect(textContent(dialog.root)).not.toContain("移除扫描配置");
    const help = find(dialog.root, (node) => node.props["aria-label"] === "扫描说明");
    if (!help) throw new Error("Missing scan help");
    click(help);
    await settle();
    expect(textContent(dialog.root)).toContain("移除扫描配置");
    expect(textContent(dialog.root)).toContain("不会删除已入库歌曲");
    const close = find(dialog.root, (node) => node.props["aria-label"] === "关闭说明");
    if (!close) throw new Error("Missing help close button");
    click(close);
    await settle();
    expect(textContent(dialog.root)).not.toContain("移除扫描配置");
    expect(
      find(dialog.root, (node) => node.props["aria-labelledby"] === "scan-dialog-title")?.open,
    ).toBe(true);
  });

  it("directory additions/removals update the list without success toasts", async () => {
    let directories: Directory[] = [];
    const dialog = mountDialog(idleScan(), async (command) => {
      if (command === "list_music_library_directories") return directories;
      if (command === "add_music_library_directory") {
        directories = [directory];
        return true;
      }
      if (command === "remove_music_library_directory") {
        directories = [];
        return;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    await settle();
    click(button(dialog.root, "添加目录"));
    await settle();
    expect(textContent(dialog.root)).toContain(directory.displayPath);
    expect(notifications.items.value).toEqual([]);
    click(button(dialog.root, "移除"));
    await settle();
    expect(textContent(dialog.root)).not.toContain(directory.displayPath);
    expect(notifications.items.value).toEqual([]);
  });

  it("duplicate additions keep the saved list without notifications", async () => {
    const dialog = mountDialog(idleScan(), async (command) => {
      if (command === "list_music_library_directories") return [directory];
      return false;
    });
    await settle();
    click(button(dialog.root, "添加目录"));
    await settle();
    expect(textContent(dialog.root)).toContain(directory.displayPath);
    expect(textContent(dialog.root)).not.toContain("目录已添加");
    expect(notifications.items.value).toEqual([]);
  });

  it("directory operation failures notify without removing the saved entry", async () => {
    const dialog = mountDialog(idleScan(), async (command) => {
      if (command === "list_music_library_directories") return [directory];
      throw new Error("permission denied");
    });
    await settle();
    click(button(dialog.root, "添加目录"));
    await settle();
    expect(textContent(dialog.root)).not.toContain("添加目录失败");
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "添加目录失败，请查看日志",
    });
    notifications.clear();
    click(button(dialog.root, "移除"));
    await settle();
    expect(textContent(dialog.root)).not.toContain("移除目录失败");
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "移除目录失败，请查看日志",
    });
    expect(textContent(dialog.root)).toContain(directory.displayPath);
  });

  it("notifies directory read failures without empty-state or retry controls", async () => {
    const dialog = mountDialog(idleScan(), async () => {
      throw new Error("read failed");
    });
    await settle();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "读取已保存目录失败，请查看日志",
    });
    expect(textContent(dialog.root)).not.toContain("无目录");
    expect(textContent(dialog.root)).not.toContain("重试");
    expect(find(dialog.root, (node) => node.props.role === "alert")).toBeNull();
  });

  it("closes immediately and completes scanning even after the dialog unmounts", async () => {
    let resolveScan!: (result: IngestResult) => void;
    const scan = createScan(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve;
        }),
    );
    const dialog = mountDialog(scan, async () => [directory]);
    await settle();
    const element = find(dialog.root, (node) => node.type === "dialog");
    expect(element?.open).toBe(true);
    click(button(dialog.root, "开始扫描"));
    expect(element?.open).toBe(false);
    expect(scan.isScanning.value).toBe(true);
    expect(notifications.items.value).toEqual([]);
    dialog.unmount();
    resolveScan({ added: 2, updated: 1, skipped: 0, failed: 0 });
    await settle();
    expect(scan.isScanning.value).toBe(false);
    expect(notifications.items.value[0]).toMatchObject({
      type: "success",
      message: "扫描完成：新增 2 首，更新 1 首",
    });
    expect(events).toEqual(["newbee:library-changed"]);
  });

  it("keeps scan failure notifications after closing and blocks another active scan", async () => {
    let rejectScan!: (error: Error) => void;
    let calls = 0;
    const scan = createScan(() => {
      calls++;
      return new Promise((_resolve, reject) => {
        rejectScan = reject;
      });
    });
    const dialog = mountDialog(scan, async () => [directory]);
    await settle();
    click(button(dialog.root, "开始扫描"));
    dialog.show();
    await settle();
    const scanButton = button(dialog.root, "正在扫描…");
    expect(scanButton.props.disabled).toBe(true);
    const handler = scanButton.props.onClick;
    if (typeof handler === "function") handler();
    expect(calls).toBe(1);
    expect(find(dialog.root, (node) => node.type === "dialog")?.open).toBe(true);
    rejectScan(new Error("database unavailable"));
    await settle();
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "扫描失败，请查看日志",
    });
    expect(events).toEqual([]);
  });
});

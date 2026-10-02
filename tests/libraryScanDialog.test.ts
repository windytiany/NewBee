// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { notifications, notify } from "@/notification/center";
import type { useLibraryScan, LibraryScanResult } from "@/library/scan";

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
const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const compilerOptions = { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 };
const scanOutput = transpileModule(
  await bunRuntime.Bun.file(new URL("../src/library/scan.ts", import.meta.url)).text(),
  { compilerOptions },
).outputText;
const { descriptor } = parse(
  await bunRuntime.Bun.file(
    new URL("../src/library/ui/LibraryScanDialog.vue", import.meta.url),
  ).text(),
  { filename: "src/library/ui/LibraryScanDialog.vue" },
);
const compiled = compileScript(descriptor, {
  id: "library-scan-dialog-test",
  inlineTemplate: true,
});
const dialogOutput = transpileModule(compiled.content, { compilerOptions }).outputText;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const apps: Array<{ unmount: () => void }> = [];
let events: string[];

function createScan(invoke: () => Promise<LibraryScanResult>) {
  const module = { exports: {} as { useLibraryScan: typeof useLibraryScan } };
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@tauri-apps/api/core": { invoke },
    "@/notification/center": { notify },
    "@/library/changes": {
      reportLibraryImport: () => {
        globalThis.window.dispatchEvent(new Event("newbee:library-changed"));
      },
    },
  };
  new Function("require", "module", "exports", scanOutput)(
    (name: string) => modules[name],
    module,
    module.exports,
  );
  return module.exports.useLibraryScan();
}
function mountDialog(
  scan: ReturnType<typeof useLibraryScan>,
  invoke: (command: string) => Promise<unknown>,
) {
  const module = { exports: {} as { default: Vue.Component } };
  const modules: Record<string, unknown> = {
    vue: Vue,
    "@tauri-apps/api/core": { invoke, isTauri: () => true },
    "@tauri-apps/plugin-dialog": { open: async () => directory.path },
    "@/library/scan": { useLibraryScan: () => scan },
    "@/notification/center": { notify },
  };
  new Function("require", "module", "exports", dialogOutput)(
    (name: string) => modules[name],
    module,
    module.exports,
  );
  const renderer = Vue.createRenderer<HostNode, HostNode>({
    patchProp: (node, key, _previous, next) => {
      node.props[key] = next;
    },
    insert: (node, parent, anchor) => {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(node);
      else parent.children.splice(index, 0, node);
    },
    remove: (node) => {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = null;
    },
    createElement: (type) => new HostNode(type),
    createText: (text) => Object.assign(new HostNode("#text"), { text }),
    createComment: (text) => Object.assign(new HostNode("#comment"), { text }),
    setText: (node, text) => {
      node.text = text;
    },
    setElementText: (node, text) => {
      node.text = text;
      node.children = [];
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  });
  const root = new HostNode("root");
  const dialog = Vue.shallowRef<{ show: () => void } | null>(null);
  const app = renderer.createApp({
    setup: () => () => Vue.h(module.exports.default, { ref: dialog }),
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

  it("duplicate additions still explain why the list did not change", async () => {
    const dialog = mountDialog(idleScan(), async (command) => {
      if (command === "list_music_library_directories") return [directory];
      return false;
    });
    await settle();
    click(button(dialog.root, "添加目录"));
    await settle();
    expect(notifications.items.value[0]).toMatchObject({
      type: "info",
      message: "该目录已经保存。",
    });
  });

  it("directory operation failures still notify and do not remove the saved entry", async () => {
    const dialog = mountDialog(idleScan(), async (command) => {
      if (command === "list_music_library_directories") return [directory];
      throw new Error("permission denied");
    });
    await settle();
    click(button(dialog.root, "添加目录"));
    await settle();
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "添加目录失败：permission denied",
    });
    notifications.clear();
    click(button(dialog.root, "移除"));
    await settle();
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "移除目录失败：permission denied",
    });
    expect(textContent(dialog.root)).toContain(directory.displayPath);
  });

  it("closes immediately and completes scanning even after the dialog unmounts", async () => {
    let resolveScan!: (result: LibraryScanResult) => void;
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
      message: "扫描完成：新增 2，更新 1，跳过 0，读取失败 0",
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
      message: "扫描失败：database unavailable",
    });
    expect(events).toEqual([]);
  });
});

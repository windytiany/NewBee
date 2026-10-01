// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ref } from "vue";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { notifications, notify } from "@/notification/center";
import type { useLibraryScan } from "@/library/scan";

type ScanResult = { added: number; updated: number; skipped: number; failed: number };
const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const source = await bunRuntime.Bun.file(new URL("../src/library/scan.ts", import.meta.url)).text();
const output = transpileModule(source, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
}).outputText;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let events: string[];
function createScan(invoke: () => Promise<ScanResult>) {
  const module = { exports: {} as { useLibraryScan: typeof useLibraryScan } };
  const modules: Record<string, unknown> = {
    vue: { ref },
    "@tauri-apps/api/core": { invoke },
    "@/notification/center": { notify },
  };
  new Function("require", "module", "exports", output)(
    (name: string) => modules[name],
    module,
    module.exports,
  );
  return module.exports.useLibraryScan();
}
beforeEach(() => {
  events = [];
  notifications.clear();
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
  notifications.clear();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("scan notifications", () => {
  it("reports complete statistics as success and still refreshes library consumers", async () => {
    const scan = createScan(async () => ({ added: 2, updated: 3, skipped: 4, failed: 0 }));
    await scan.scanMusicLibrary();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "success",
      message: "扫描完成：新增 2，更新 3，跳过 4，读取失败 0",
    });
    expect(events).toEqual(["newbee:library-scan-completed"]);
    expect(scan.isScanning.value).toBe(false);
  });

  it("keeps partial failure statistics as a persistent warning", async () => {
    const scan = createScan(async () => ({ added: 2, updated: 0, skipped: 0, failed: 1 }));
    await scan.scanMusicLibrary();
    expect(notifications.items.value[0]).toMatchObject({ type: "warning" });
    expect(notifications.items.value[0].message).toContain("读取失败 1");
    notifications.dismiss(notifications.items.value[0].id);
    expect(scan.scanResult.value?.failed).toBe(1);
  });

  it("injected backend errors produce one toast without a scan-completed event", async () => {
    const scan = createScan(async () => {
      throw new Error("permission denied");
    });
    await scan.scanMusicLibrary();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "扫描失败：permission denied",
    });
    expect(events).toEqual([]);
    expect(scan.isScanning.value).toBe(false);
    notifications.dismiss(notifications.items.value[0].id);
    expect(scan.scanError.value).toBe("permission denied");
  });

  it("does not report pending work and ignores a concurrent scan request", async () => {
    let resolveScan!: (result: ScanResult) => void;
    let calls = 0;
    const scan = createScan(() => {
      calls++;
      return new Promise((resolve) => {
        resolveScan = resolve;
      });
    });
    const pending = scan.scanMusicLibrary();
    await scan.scanMusicLibrary();
    expect(calls).toBe(1);
    expect(notifications.items.value).toEqual([]);
    expect(scan.isScanning.value).toBe(true);
    resolveScan({ added: 1, updated: 0, skipped: 0, failed: 0 });
    await pending;
    expect(notifications.items.value).toHaveLength(1);
    expect(scan.isScanning.value).toBe(false);
  });
});

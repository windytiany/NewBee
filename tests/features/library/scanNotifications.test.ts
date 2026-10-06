import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ref } from "vue";
import { transpileScript, evaluateSource } from "../../support/moduleLoader";

import { notifications, notify } from "@/shared/notifications/center";
import type { useLibraryScan } from "@/features/library/import/useScan";

type ScanResult = { added: number; updated: number; skipped: number; failed: number };

const source = await Bun.file(
  new URL("../../../src/features/library/import/useScan.ts", import.meta.url),
).text();
const output = transpileScript(source);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let events: string[];
function createScan(invoke: () => Promise<ScanResult>) {
  const modules: Record<string, unknown> = {
    vue: { ref },
    "@tauri-apps/api/core": { invoke },
    "@/shared/notifications/center": { notify },
    "@/features/library/events": {
      reportLibraryImport: () => {
        globalThis.window.dispatchEvent(new Event("newbee:library-changed"));
      },
    },
  };
  return evaluateSource<{ useLibraryScan: typeof useLibraryScan }>(
    output,
    modules,
  ).useLibraryScan();
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
      message: "扫描完成：新增 2 首，更新 3 首",
    });
    expect(events).toEqual(["newbee:library-changed"]);
    expect(scan.isScanning.value).toBe(false);
  });

  it("reports partial failures as a recoverable warning", async () => {
    const scan = createScan(async () => ({ added: 2, updated: 0, skipped: 0, failed: 1 }));
    await scan.scanMusicLibrary();
    expect(notifications.items.value[0]).toMatchObject({ type: "warning" });
    expect(notifications.items.value[0].message).toContain("1 首失败");
    notifications.dismiss(notifications.items.value[0].id);
    expect(scan.scanResult.value?.failed).toBe(1);
  });

  it("injected backend errors produce one toast without a library change", async () => {
    const scan = createScan(async () => {
      throw new Error("permission denied");
    });
    await scan.scanMusicLibrary();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "扫描失败，请查看日志",
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

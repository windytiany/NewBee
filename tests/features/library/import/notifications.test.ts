import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { computed, ref } from "vue";
import { transpileScript, evaluateSource } from "../../../support/module/loader";

import { notifications, notify } from "@/shared/notifications/center";
import { tasks } from "@/shared/tasks/state";
import type { useLibraryScan } from "@/features/library/import/useScan";

type ScanResult = { added: number; updated: number; skipped: number; failed: number };

const source = await Bun.file(
  new URL("../../../../src/features/library/import/useScan.ts", import.meta.url),
).text();
const output = transpileScript(source);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let events: string[];
let receiveProgress: (event: {
  payload: { operationId: string; completed: number; total: number };
}) => void;
let unlistened: boolean;
let activeOperation: string;
const monitoringSnapshot = ref<{ progress: { completed: number; total: number } | null }>({
  progress: null,
});
function createScan(invoke: () => Promise<ScanResult>) {
  const modules: Record<string, unknown> = {
    vue: { computed, ref },
    "@/features/library/monitoring/state": { monitoringSnapshot },
    "@tauri-apps/api/core": {
      invoke: (_command: string, args: { operationId: string }) => {
        activeOperation = args.operationId;
        return invoke();
      },
    },
    "@tauri-apps/api/event": {
      listen: async (_event: string, receive: typeof receiveProgress) => {
        receiveProgress = receive;
        return () => {
          unlistened = true;
        };
      },
    },
    "@/shared/notifications/center": { notifications, notify },
    "@/shared/tasks/state": { tasks },
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
  monitoringSnapshot.value = { progress: null };
  unlistened = false;
  notifications.clear();
  tasks.acknowledge();
  tasks.clearFinished();
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
  it("does not start a conflicting scan while folder monitoring is writing", async () => {
    let calls = 0;
    const scan = createScan(async () => {
      calls++;
      throw new Error("background write in progress");
    });
    monitoringSnapshot.value = { progress: { completed: 30, total: 3000 } };
    expect(scan.isScanning.value).toBe(true);
    await scan.scanMusicLibrary();
    expect(calls).toBe(0);
    expect(notifications.items.value).toEqual([]);
    monitoringSnapshot.value = { progress: null };
    expect(scan.isScanning.value).toBe(false);
  });

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

  it("reports no changes when no tracks were added or updated", async () => {
    const scan = createScan(async () => ({ added: 0, updated: 0, skipped: 4, failed: 0 }));
    await scan.scanMusicLibrary();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "success",
      message: "未发现变化",
    });
    expect(events).toEqual(["newbee:library-changed"]);
  });

  it("reports failures even when no tracks changed", async () => {
    const scan = createScan(async () => ({ added: 0, updated: 0, skipped: 0, failed: 1 }));
    await scan.scanMusicLibrary();
    expect(notifications.items.value[0]).toMatchObject({
      type: "warning",
      message: "扫描完成，1 首失败（详情见日志）",
    });
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
    expect(tasks.active.value).toEqual([]);
    expect(tasks.items.value[0]?.result).toMatchObject({ type: "error" });
    expect(unlistened).toBe(true);
  });

  it("shows pending progress, filters unrelated events and ignores concurrent scans", async () => {
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
    expect(tasks.items.value).toHaveLength(1);
    expect(tasks.items.value[0].total).toBeUndefined();
    receiveProgress({ payload: { operationId: "other", completed: 9, total: 10 } });
    expect(tasks.items.value[0].completed).toBe(0);
    receiveProgress({ payload: { operationId: activeOperation, completed: 3, total: 10 } });
    expect(tasks.items.value[0]).toMatchObject({ completed: 3, total: 10 });
    resolveScan({ added: 1, updated: 0, skipped: 0, failed: 0 });
    await pending;
    expect(tasks.items.value).toEqual([]);
    expect(unlistened).toBe(true);
    expect(notifications.items.value).toHaveLength(1);
    expect(scan.isScanning.value).toBe(false);
  });
});

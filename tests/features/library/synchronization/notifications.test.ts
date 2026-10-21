import { beforeEach, describe, expect, it } from "bun:test";
import { notifications } from "@/shared/notifications/center";
import { createSynchronization } from "../../../support/library/synchronization";
import type { IngestResult } from "@/features/library/types";

const unchanged = { added: 0, updated: 0, skipped: 4, failed: 0 };
beforeEach(() => notifications.clear());

describe("manual synchronization", () => {
  it("uses the unified command and refreshes the shared snapshot", async () => {
    const context = createSynchronization(async () => ({
      added: 2,
      updated: 3,
      skipped: 4,
      failed: 0,
    }));
    await context.scan.synchronizeLibrary();
    expect(context.calls).toHaveLength(1);
    expect(context.calls[0]?.command).toBe("synchronize_library");
    expect(context.calls[0]?.args).toHaveProperty("operationId");
    expect(context.refreshed).toBe(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "success",
      message: "扫描完成：新增 2 首，更新 3 首",
    });
    expect(context.scan.isScanning.value).toBe(false);
  });

  for (const phase of ["progress", "settling"] as const) {
    it(`does not overlap background synchronization during ${phase}`, async () => {
      const context = createSynchronization(async () => unchanged);
      context.snapshot.value = {
        missing: [],
        progress: phase === "progress" ? { path: "/Music", completed: 1, total: 10 } : null,
        statuses: phase === "settling" ? [{ path: "/Music", phase: "scanning", error: null }] : [],
      };
      expect(context.scan.isScanning.value).toBe(true);
      await context.scan.synchronizeLibrary();
      expect(context.calls).toEqual([]);
      expect(notifications.items.value).toEqual([]);
      context.snapshot.value = { progress: null, statuses: [], missing: [] };
      expect(context.scan.isScanning.value).toBe(false);
    });
  }

  it("reports no changes without treating retained missing files as an import failure", async () => {
    const context = createSynchronization(async () => unchanged);
    context.snapshot.value.missing = ["/Music/missing.wav"];
    await context.scan.synchronizeLibrary();
    expect(notifications.items.value[0]).toMatchObject({ type: "success", message: "未发现变化" });
    expect(context.snapshot.value.missing).toEqual(["/Music/missing.wav"]);
  });

  for (const added of [0, 2]) {
    it(`reports partial failure when ${added} tracks were added`, async () => {
      const context = createSynchronization(async () => ({ ...unchanged, added, failed: 1 }));
      await context.scan.synchronizeLibrary();
      expect(notifications.items.value[0]).toMatchObject({
        type: "warning",
        message: "扫描完成，1 首失败",
      });
      expect(context.scan.scanResult.value?.failed).toBe(1);
    });
  }

  it("reports a busy command as a recoverable warning", async () => {
    const context = createSynchronization(async () => {
      throw {
        code: "write_busy",
        message: "数据写入或备份任务正在运行",
        detail: "write lock held",
      };
    });
    await context.scan.synchronizeLibrary();
    expect(notifications.items.value[0]).toMatchObject({
      type: "warning",
      message: "数据写入或备份任务正在运行",
    });
    expect(context.refreshed).toBe(0);
  });

  it("does not expose diagnostic details", async () => {
    const context = createSynchronization(async () => {
      throw {
        code: "scan_failed",
        message: "扫描失败",
        detail: "SELECT private FROM internal\nstack",
      };
    });
    await context.scan.synchronizeLibrary();
    expect(notifications.items.value[0]?.message).toBe("扫描失败");
  });

  it("keeps the failure and releases pending state for a retry", async () => {
    const context = createSynchronization(async () => {
      throw new Error("permission denied");
    });
    await context.scan.synchronizeLibrary();
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]).toMatchObject({
      type: "error",
      message: "permission denied",
    });
    expect(context.scan.scanError.value).toBe("permission denied");
    expect(context.scan.isScanning.value).toBe(false);
    expect(context.refreshed).toBe(0);
  });

  it("blocks concurrent manual requests while the original request is pending", async () => {
    let resolve!: (result: IngestResult) => void;
    const context = createSynchronization(
      () =>
        new Promise((finish) => {
          resolve = finish;
        }),
    );
    const pending = context.scan.synchronizeLibrary();
    await context.scan.synchronizeLibrary();
    expect(context.calls).toHaveLength(1);
    expect(context.scan.isScanning.value).toBe(true);
    expect(notifications.items.value).toEqual([]);
    resolve(unchanged);
    await pending;
    expect(context.scan.isScanning.value).toBe(false);
    expect(context.refreshed).toBe(1);
  });

  it("does not invoke native commands in browser preview", async () => {
    const context = createSynchronization(async () => unchanged, false);
    await context.scan.synchronizeLibrary();
    expect(context.calls).toEqual([]);
  });
});

import { describe, expect, it } from "bun:test";
import { createTaskCenter, taskPercentage } from "@/shared/tasks/state";
import { createNotificationCenter } from "@/shared/notifications/center";

const progress = { key: "scan", message: "扫描", completed: 0 };

describe("background tasks", () => {
  it("updates in place without reordering concurrent tasks or depending on toast lifetime", () => {
    const tasks = createTaskCenter();
    const notifications = createNotificationCenter();
    tasks.update(progress);
    tasks.update({ ...progress, key: "lyrics", total: 10, completed: 3 });
    tasks.update({ ...progress, total: 3000, completed: 1260 });
    notifications.clear();
    expect(tasks.active.value.map((task) => task.key)).toEqual(["scan", "lyrics"]);
    expect(taskPercentage(tasks.active.value[0]!)).toBe(42);
    expect(notifications.items.value).toEqual([]);
    tasks.finish("scan");
    expect(tasks.items.value.map((task) => task.key)).toEqual(["lyrics"]);
  });

  it("retains failures until viewed and cleared, without clearing running tasks", () => {
    const tasks = createTaskCenter();
    tasks.update({ ...progress, cancel: () => {} });
    tasks.update({ ...progress, key: "lyrics" });
    tasks.finish("scan", { type: "warning", message: "1 首失败" });
    expect(tasks.active.value.map((task) => task.key)).toEqual(["lyrics"]);
    expect(tasks.unread.value).toBe(true);
    expect(tasks.items.value[0]?.cancel).toBeUndefined();
    tasks.clearFinished();
    expect(tasks.items.value).toHaveLength(2);
    tasks.acknowledge();
    expect(tasks.unread.value).toBe(false);
    tasks.finish("scan", { type: "error", message: "重复终态" });
    expect(tasks.unread.value).toBe(false);
    expect(tasks.items.value[0]?.result?.message).toBe("1 首失败");
    tasks.clearFinished();
    expect(tasks.items.value.map((task) => task.key)).toEqual(["lyrics"]);
  });

  it("replaces a previous result when the same business task starts again", () => {
    const tasks = createTaskCenter();
    tasks.finish("unknown", { type: "error", message: "失败" });
    expect(tasks.items.value).toEqual([]);
    tasks.update(progress);
    tasks.finish("scan", { type: "error", message: "失败" });
    tasks.update(progress);
    expect(tasks.active.value).toHaveLength(1);
    expect(tasks.unread.value).toBe(false);
    tasks.finish("scan");
    expect(tasks.items.value).toEqual([]);
  });

  it("preserves cancellation and clamps progress without inventing an unknown percentage", () => {
    const tasks = createTaskCenter();
    let cancelled = 0;
    const task = { ...progress, cancel: () => cancelled++ };
    tasks.update(task);
    tasks.active.value[0]?.cancel?.();
    expect(cancelled).toBe(1);
    tasks.update({ ...task, cancelling: true });
    expect(tasks.active.value[0]?.cancelling).toBe(true);
    expect(taskPercentage(progress)).toBeUndefined();
    expect(taskPercentage({ completed: 0, total: 0 })).toBeUndefined();
    expect(taskPercentage({ completed: 11, total: 10 })).toBe(100);
    expect(taskPercentage({ completed: -1, total: 10 })).toBe(0);
  });
});

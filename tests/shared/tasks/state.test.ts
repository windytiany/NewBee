import { describe, expect, it } from "bun:test";
import { createTaskCenter, taskPercentage } from "@/shared/tasks/state";
import { createNotificationCenter } from "@/shared/notifications/center";

const progress = { key: "scan", message: "扫描", completed: 0 };

describe("background tasks", () => {
  it("updates progress in place and removes completed tasks without a toast", () => {
    const notifications = createNotificationCenter();
    const tasks = createTaskCenter(notifications.notify);
    tasks.update(progress);
    tasks.update({ ...progress, key: "lyrics", total: 10, completed: 3 });
    tasks.update({ ...progress, total: 3000, completed: 1260 });
    expect(tasks.active.value.map((task) => task.key)).toEqual(["scan", "lyrics"]);
    expect(taskPercentage(tasks.active.value[0]!)).toBe(42);
    tasks.finish("scan");
    expect(tasks.items.value.map((task) => task.key)).toEqual(["lyrics"]);
    expect(notifications.items.value).toEqual([]);
  });

  it("removes failures and reports them once without clearing running tasks", () => {
    const notifications = createNotificationCenter();
    const tasks = createTaskCenter(notifications.notify);
    tasks.update({ ...progress, cancel: () => {} });
    tasks.update({ ...progress, key: "lyrics" });
    tasks.finish("scan", { type: "warning", message: "1 首失败" });
    expect(tasks.items.value.map((task) => task.key)).toEqual(["lyrics"]);
    expect(notifications.items.value[0]).toMatchObject({ type: "warning", message: "1 首失败" });
    tasks.finish("scan", { type: "error", message: "重复终态" });
    expect(notifications.items.value).toHaveLength(1);
    expect(notifications.items.value[0]?.count).toBe(1);
    notifications.clear();
  });

  it("allows a failed task to restart and ignores unknown completions", () => {
    const notifications = createNotificationCenter();
    const tasks = createTaskCenter(notifications.notify);
    tasks.finish("unknown", { type: "error", message: "失败" });
    expect(notifications.items.value).toEqual([]);
    tasks.update(progress);
    tasks.finish("scan", { type: "error", message: "失败" });
    tasks.update(progress);
    expect(tasks.active.value).toHaveLength(1);
    tasks.finish("scan");
    expect(tasks.items.value).toEqual([]);
    notifications.clear();
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

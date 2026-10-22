import { beforeEach, expect, it } from "bun:test";
import type { invoke } from "@tauri-apps/api/core";
import { createWriteQueue, TaskCancelled } from "@/features/tasks/queue";
import { createTaskCenter } from "@/shared/tasks/state";
import { notifications } from "@/shared/notifications/center";

beforeEach(() => notifications.clear());
import { createMetadataSave } from "@/features/metadata/save";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup() {
  const calls: { command: string; id: string }[] = [];
  const center = createTaskCenter();
  const command: typeof invoke = async <T>(command: string, args?: unknown) => {
    calls.push({ command, id: (args as { id: string }).id });
    return (command === "reserve_task" ? null : undefined) as T;
  };
  return { queue: createWriteQueue(command, center), center, calls };
}
const request = (id: string) => ({ id, message: id, fingerprint: id, trackIds: [Number(id)] });

it("executes FIFO, reserves waiting targets immediately, and continues after failure", async () => {
  const { queue, center, calls } = setup();
  const gate = deferred();
  const executed: string[] = [];
  const first = queue.run(request("1"), async () => {
    executed.push("1");
    await gate.promise;
    throw new Error("failed");
  });
  const failure = first.catch((error: unknown) => error);
  const second = queue.run(request("2"), async () => {
    executed.push("2");
    return 42;
  });
  await settle();
  expect(executed).toEqual(["1"]);
  expect(calls.filter(({ command }) => command === "reserve_task").map(({ id }) => id)).toEqual([
    "1",
    "2",
  ]);
  expect(center.active.value.find(({ key }) => key === "2")?.phase).toBe("queued");
  gate.resolve();
  expect(await failure).toBeInstanceOf(Error);
  expect(await second).toBe(42);
  expect(executed).toEqual(["1", "2"]);
  expect(queue.active.value).toBe(false);
  expect(center.items.value).toEqual([]);
  expect(notifications.items.value[0]?.message).toBe("failed");
});

it("cancels a queued task immediately without allowing successors to overtake running work", async () => {
  const { queue, center, calls } = setup();
  const gate = deferred();
  const executed: string[] = [];
  const first = queue.run(request("1"), () => gate.promise);
  const second = queue.run(request("2"), async () => {
    executed.push("2");
  });
  const cancellation = second.catch((error: unknown) => error);
  const third = queue.run(request("3"), async () => {
    executed.push("3");
  });
  await settle();
  center.active.value.find(({ key }) => key === "2")!.cancel!();
  expect(await cancellation).toBeInstanceOf(TaskCancelled);
  expect(center.items.value.some((task) => task.key === "2")).toBe(false);
  expect(notifications.items.value).toEqual([]);
  expect(calls.some(({ command, id }) => command === "release_task" && id === "2")).toBe(true);
  expect(executed).toEqual([]);
  gate.resolve();
  await Promise.all([first, third]);
  expect(executed).toEqual(["3"]);
});

it("waits for a running task's safe boundary and cancellation acknowledgement before continuing", async () => {
  const { queue, center } = setup();
  const stopped = deferred();
  const acknowledged = deferred();
  let nextStarted = false;
  const first = queue.run(
    { ...request("1"), cancel: () => acknowledged.promise },
    () => stopped.promise,
  );
  const second = queue.run(request("2"), async () => {
    nextStarted = true;
  });
  await settle();
  center.active.value.find(({ key }) => key === "1")!.cancel!();
  expect(center.active.value.find(({ key }) => key === "1")?.cancelling).toBe(true);
  stopped.resolve();
  await settle();
  expect(nextStarted).toBe(false);
  acknowledged.resolve();
  await Promise.all([first, second]);
  expect(nextStarted).toBe(true);
  expect(queue.wasCancelled("1")).toBe(true);
  expect(center.items.value).toEqual([]);
  expect(notifications.items.value).toEqual([]);
});

it("reports cancellation errors and still waits for the running task to end", async () => {
  const center = createTaskCenter();
  const gate = deferred();
  const command: typeof invoke = async <T>(command: string) => {
    if (command === "cancel_task") throw new Error("cancel failed");
    return null as T;
  };
  const queue = createWriteQueue(command, center);
  const task = queue.run(request("1"), () => gate.promise).catch((error: unknown) => error);
  await settle();
  center.active.value[0]!.cancel!();
  await settle();
  expect(queue.active.value).toBe(true);
  gate.resolve();
  expect(((await task) as Error).message).toBe("cancel failed");
  expect(center.items.value).toEqual([]);
  expect(notifications.items.value[0]).toMatchObject({ type: "error", message: "cancel failed" });
  expect(queue.active.value).toBe(false);
});

for (const error of ["任务已取消", new TaskCancelled()]) {
  it(`removes backend cancellation without a failure toast: ${String(error)}`, async () => {
    const { queue, center } = setup();
    await expect(
      queue.run(request("1"), async () => {
        throw error;
      }),
    ).rejects.toBeInstanceOf(TaskCancelled);
    expect(center.items.value).toEqual([]);
    expect(notifications.items.value).toEqual([]);
    expect(queue.wasCancelled("1")).toBe(true);
  });
}

it("rejects duplicate submission without executing it twice", async () => {
  const { queue } = setup();
  const gate = deferred();
  const first = queue.run(request("1"), () => gate.promise);
  await expect(queue.run(request("1"), async () => {})).rejects.toThrow("任务已在队列中");
  gate.resolve();
  await first;
});

it("keeps the queue usable after a rejected backend reservation", async () => {
  const center = createTaskCenter();
  const command: typeof invoke = async <T>(command: string, args?: unknown) => {
    if (command === "reserve_task" && (args as { id: string }).id === "1")
      throw new Error("occupied");
    return null as T;
  };
  const queue = createWriteQueue(command, center);
  const first = queue.run(request("1"), async () => {
    throw new Error("must not execute");
  });
  await expect(first).rejects.toThrow("occupied");
  expect(await queue.run(request("2"), async () => 42)).toBe(42);
  expect(queue.active.value).toBe(false);
});

it("defers playback editing until the metadata task actually starts", async () => {
  const { queue } = setup();
  const gate = deferred();
  const first = queue.run(request("1"), () => gate.promise);
  const edits: number[][] = [];
  const saving = createMetadataSave({
    schedule: queue.run,
    synchronize: () => {},
    editFiles: async (ids, execute) => {
      edits.push([...ids]);
      return execute();
    },
  });
  const metadata = saving.run({
    operationId: "metadata",
    fingerprint: "metadata",
    targets: [{ trackId: 2, path: "two.wav" }],
    writeTrackIds: [2],
    execute: async () => {
      expect(queue.owns("metadata")).toBe(true);
      return [
        { trackId: 2, path: "two.wav", fileWritten: true, databaseUpdated: true, error: null },
      ];
    },
  });
  await settle();
  expect(edits).toEqual([]);
  gate.resolve();
  await Promise.all([first, metadata]);
  expect(edits).toEqual([[2]]);
});

it("permits restore only while idle and rejects new work until it returns", async () => {
  const { queue } = setup();
  const gate = deferred();
  const first = queue.run(request("1"), () => gate.promise);
  await expect(queue.restore(async () => {})).rejects.toThrow("请等待后台任务结束");
  gate.resolve();
  await first;
  const restoreGate = deferred();
  const restore = queue.restore(() => restoreGate.promise);
  await expect(queue.run(request("2"), async () => {})).rejects.toThrow("正在恢复备份");
  restoreGate.resolve();
  await restore;
  await queue.run(request("3"), async () => {});
});

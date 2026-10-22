import { beforeEach, expect, it } from "bun:test";
import * as Vue from "vue";
import type { invoke } from "@tauri-apps/api/core";
import type { taskInvoke } from "@/features/tasks/commands";
import { createWriteQueue } from "@/features/tasks/queue";
import { createTaskCenter } from "@/shared/tasks/state";
import { notifications } from "@/shared/notifications/center";

beforeEach(() => notifications.clear());
import { evaluateSource, transpileScript } from "../../support/module/loader";

const output = transpileScript(await Bun.file("src/features/tasks/commands.ts").text());
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
class Channel {
  onmessage: (value: unknown) => void = () => {};
}
function setup(execute: (command: string, args: Record<string, unknown>) => Promise<unknown>) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const center = createTaskCenter();
  const native: typeof invoke = async <T>(command: string, args?: unknown) => {
    const values = (args ?? {}) as Record<string, unknown>;
    calls.push({ command, args: values });
    if (["reserve_task", "start_task", "release_task", "cancel_task"].includes(command))
      return null as T;
    return (await execute(command, values)) as T;
  };
  const queue = createWriteQueue(native, center);
  const module = evaluateSource<{ taskInvoke: typeof taskInvoke }>(output, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke: native, Channel },
    "@/shared/tasks/state": { tasks: center },
    "@/features/tasks/queue": { runWriteTask: queue.run, writeQueue: queue },
  });
  return { invoke: module.taskInvoke, queue, center, calls };
}

it("freezes queued metadata payloads, reserves revisions and reports actual progress", async () => {
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received: unknown[] = [];
  const test = setup(async (command, args) => {
    if (command === "import_music_files") {
      await blocker;
      return { added: 1, updated: 0, failed: 0 };
    }
    expect(command).toBe("save_track_metadata");
    expect(args.request).toMatchObject({
      trackIds: [2],
      changes: [{ field: "title", value: "Submitted" }],
    });
    (args.onProgress as Channel).onmessage({
      trackId: 2,
      databaseUpdated: true,
      fileWritten: true,
    });
    return [{ trackId: 2, databaseUpdated: true, fileWritten: true, error: null }];
  });
  const first = test.invoke("import_music_files", { paths: ["one.wav"] });
  const channel = new Channel();
  channel.onmessage = (value) => received.push(value);
  const request = Vue.reactive({
    trackIds: [2],
    changes: [{ field: "title", value: "Submitted" }],
  });
  const second = test.invoke("save_track_metadata", {
    request,
    onProgress: channel,
    expected: [{ trackId: 2, value: "version" }],
  });
  request.changes[0]!.value = "Later edit";
  request.trackIds[0] = 99;
  await settle();
  const reservations = test.calls.filter(({ command }) => command === "reserve_task");
  expect(reservations[1]?.args).toMatchObject({
    trackIds: [2],
    expected: [{ trackId: 2, value: "version" }],
  });
  expect(test.center.active.value.map(({ phase }) => phase)).toEqual(["running", "queued"]);
  release();
  await Promise.all([first, second]);
  expect(received).toHaveLength(1);
  expect(test.center.active.value).toEqual([]);
});

it("toasts partial failures and removes tasks without blocking subsequent work", async () => {
  const test = setup(async () => [
    { trackId: 7, databaseUpdated: false, fileWritten: false, error: "readonly" },
  ]);
  await test.invoke("save_track_metadata", { request: { trackIds: [7] } });
  expect(test.center.items.value).toEqual([]);
  expect(notifications.items.value[0]).toMatchObject({
    type: "warning",
    message: "1 项处理失败",
  });
  expect(test.queue.active.value).toBe(false);
});

it("does not enqueue reads or ordinary settings writes", async () => {
  const test = setup(async () => []);
  await test.invoke("get_tracks", { trackIds: [1] });
  await test.invoke("save_settings", { settings: {} });
  expect(test.calls.map(({ command }) => command)).toEqual(["get_tracks", "save_settings"]);
});

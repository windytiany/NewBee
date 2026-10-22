import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateSource, transpileScript } from "../../../support/module/loader";
import type * as State from "@/features/library/synchronization/state";
import type { SynchronizationSnapshot } from "@/features/library/synchronization/types";
import { tasks } from "@/shared/tasks/state";
import { notifications } from "@/shared/notifications/center";

afterEach(() => {
  tasks.finish("library-synchronization");
  notifications.clear();
});

const source = transpileScript(
  await Bun.file("src/features/library/synchronization/state.ts").text(),
);

it("restores an active background task from a snapshot and removes it on completion", async () => {
  let snapshot: SynchronizationSnapshot = {
    statuses: [],
    missing: [],
    progress: { path: "music", completed: 30, total: 3000 },
  };
  const state = evaluateSource<typeof State>(source, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke: async () => snapshot },
    "@/shared/tasks/state": { tasks },
  });
  await state.refreshSynchronization();
  expect(tasks.items.value).toContainEqual({
    key: "library-synchronization",
    message: "正在扫描…",
    completed: 30,
    total: 3000,
  });
  snapshot = { statuses: [], missing: [], progress: null };
  await state.refreshSynchronization();
  expect(tasks.items.value.find((task) => task.key === "library-synchronization")).toBeUndefined();
});

it("toasts a failed background scan once and removes its progress", async () => {
  let snapshot: SynchronizationSnapshot = {
    statuses: [],
    missing: [],
    progress: { path: "music", completed: 1, total: 3 },
  };
  const state = evaluateSource<typeof State>(source, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke: async () => snapshot },
    "@/shared/tasks/state": { tasks },
  });
  await state.refreshSynchronization();
  snapshot = {
    statuses: [{ path: "music", phase: "error", error: "permission denied" }],
    missing: [],
    progress: null,
  };
  await state.refreshSynchronization();
  expect(tasks.active.value).toEqual([]);
  expect(tasks.items.value).toEqual([]);
  expect(notifications.items.value[0]).toMatchObject({
    type: "error",
    message: "扫描失败",
    count: 1,
  });
  await state.refreshSynchronization();
  expect(notifications.items.value).toHaveLength(1);
  expect(notifications.items.value[0]?.count).toBe(1);
});

it("reports partial failures through a warning toast", async () => {
  let snapshot = {
    statuses: [],
    missing: [],
    progress: { path: "music", completed: 1, total: 3 },
  } as SynchronizationSnapshot;
  const state = evaluateSource<typeof State>(source, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke: async () => snapshot },
    "@/shared/tasks/state": { tasks },
  });
  await state.refreshSynchronization();
  snapshot = {
    statuses: [
      {
        path: "music",
        phase: "warning",
        error: null,
        issues: { failed: 1, replayGainFailed: 1 },
      },
    ],
    missing: [],
    progress: null,
  } as SynchronizationSnapshot;
  await state.refreshSynchronization();
  expect(tasks.active.value).toEqual([]);
  expect(tasks.items.value).toEqual([]);
  expect(notifications.items.value[0]).toMatchObject({
    type: "warning",
    message: "扫描完成，1 个文件处理异常",
  });
});

it("keeps the latest snapshot when IPC responses arrive out of order", async () => {
  const replies: ((snapshot: SynchronizationSnapshot) => void)[] = [];
  const state = evaluateSource<typeof State>(source, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke: () => new Promise((resolve) => replies.push(resolve)) },
  });
  const first = state.refreshSynchronization();
  const second = state.refreshSynchronization();
  replies[1]!({ statuses: [], missing: ["new.wav"] });
  await second;
  replies[0]!({ statuses: [], missing: ["old.wav"] });
  await first;
  expect(state.synchronizationSnapshot.value.missing).toEqual(["new.wav"]);
});

it("resolves only the presented batch and refreshes the remaining queue", async () => {
  const calls: unknown[] = [];
  const state = evaluateSource<typeof State>(source, {
    vue: Vue,
    "@tauri-apps/api/core": {
      invoke: async (command: string, args?: unknown) => {
        calls.push([command, args]);
        return command === "resolve_library_synchronization"
          ? 2
          : { statuses: [], missing: ["later.wav"] };
      },
    },
  });
  state.synchronizationSnapshot.value = { statuses: [], missing: ["a.wav", "b.wav", "later.wav"] };
  expect(await state.resolveSynchronization(["a.wav", "b.wav"], true)).toBe(2);
  expect(state.synchronizationSnapshot.value.missing).toEqual(["later.wav"]);
  await state.refreshSynchronization();
  expect(calls).toEqual([
    ["resolve_library_synchronization", { paths: ["a.wav", "b.wav"], clean: true }],
    ["get_library_synchronization", undefined],
  ]);
  expect(state.synchronizationSnapshot.value.missing).toEqual(["later.wav"]);
});

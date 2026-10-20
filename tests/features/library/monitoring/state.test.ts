import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateSource, transpileScript } from "../../../support/module/loader";
import type * as State from "@/features/library/monitoring/state";
import type { MonitoringSnapshot } from "@/features/library/monitoring/types";
import { tasks } from "@/shared/tasks/state";

afterEach(() => {
  tasks.finish("library-monitoring");
  tasks.acknowledge();
  tasks.clearFinished();
});

const source = transpileScript(await Bun.file("src/features/library/monitoring/state.ts").text());

it("restores an active background task from a snapshot and removes it on completion", async () => {
  let snapshot: MonitoringSnapshot = {
    statuses: [],
    missing: [],
    progress: { path: "music", completed: 30, total: 3000 },
  };
  const state = evaluateSource<typeof State>(source, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke: async () => snapshot },
    "@/shared/tasks/state": { tasks },
  });
  await state.refreshMonitoring();
  expect(tasks.items.value).toContainEqual({
    key: "library-monitoring",
    message: "正在扫描…",
    completed: 30,
    total: 3000,
  });
  snapshot = { statuses: [], missing: [], progress: null };
  await state.refreshMonitoring();
  expect(tasks.items.value.find((task) => task.key === "library-monitoring")).toBeUndefined();
});

it("retains a failed background scan without marking an already-viewed result unread again", async () => {
  let snapshot: MonitoringSnapshot = {
    statuses: [],
    missing: [],
    progress: { path: "music", completed: 1, total: 3 },
  };
  const state = evaluateSource<typeof State>(source, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke: async () => snapshot },
    "@/shared/tasks/state": { tasks },
  });
  await state.refreshMonitoring();
  snapshot = {
    statuses: [{ path: "music", phase: "error", error: "permission denied" }],
    missing: [],
    progress: null,
  };
  await state.refreshMonitoring();
  expect(tasks.active.value).toEqual([]);
  expect(tasks.items.value[0]?.result).toEqual({ type: "error", message: "扫描失败" });
  expect(tasks.unread.value).toBe(true);
  tasks.acknowledge();
  await state.refreshMonitoring();
  expect(tasks.unread.value).toBe(false);
});

it("keeps the latest snapshot when IPC responses arrive out of order", async () => {
  const replies: ((snapshot: MonitoringSnapshot) => void)[] = [];
  const state = evaluateSource<typeof State>(source, {
    vue: Vue,
    "@tauri-apps/api/core": { invoke: () => new Promise((resolve) => replies.push(resolve)) },
  });
  const first = state.refreshMonitoring();
  const second = state.refreshMonitoring();
  replies[1]!({ statuses: [], missing: ["new.wav"] });
  await second;
  replies[0]!({ statuses: [], missing: ["old.wav"] });
  await first;
  expect(state.monitoringSnapshot.value.missing).toEqual(["new.wav"]);
});

it("resolves only the presented batch and refreshes the remaining queue", async () => {
  const calls: unknown[] = [];
  const state = evaluateSource<typeof State>(source, {
    vue: Vue,
    "@tauri-apps/api/core": {
      invoke: async (command: string, args?: unknown) => {
        calls.push([command, args]);
        return command === "resolve_library_monitoring"
          ? 2
          : { statuses: [], missing: ["later.wav"] };
      },
    },
  });
  state.monitoringSnapshot.value = { statuses: [], missing: ["a.wav", "b.wav", "later.wav"] };
  expect(await state.resolveMonitoring(["a.wav", "b.wav"], true)).toBe(2);
  expect(state.monitoringSnapshot.value.missing).toEqual(["later.wav"]);
  await state.refreshMonitoring();
  expect(calls).toEqual([
    ["resolve_library_monitoring", { paths: ["a.wav", "b.wav"], clean: true }],
    ["get_library_monitoring", undefined],
  ]);
  expect(state.monitoringSnapshot.value.missing).toEqual(["later.wav"]);
});

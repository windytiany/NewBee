import { expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateSource, transpileScript } from "../../../support/module/loader";
import type * as State from "@/features/library/monitoring/state";
import type { MonitoringSnapshot } from "@/features/library/monitoring/types";

const source = transpileScript(await Bun.file("src/features/library/monitoring/state.ts").text());

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

import * as Vue from "vue";
import { transpileScript, evaluateSource } from "../module/loader";
import { notifications, notify } from "@/shared/notifications/center";
import { createTaskCenter } from "@/shared/tasks/state";
import type { IngestResult } from "@/features/library/types";
import type { SynchronizationSnapshot } from "@/features/library/synchronization/types";
import type { useLibrarySynchronization } from "@/features/library/synchronization/useScan";
import type * as State from "@/features/library/synchronization/state";

const output = transpileScript(
  await Bun.file("src/features/library/synchronization/useScan.ts").text(),
);
const stateOutput = transpileScript(
  await Bun.file("src/features/library/synchronization/state.ts").text(),
);
export function createSynchronization(
  invoke: () => Promise<IngestResult>,
  supported = true,
  getSnapshot?: () => Promise<SynchronizationSnapshot>,
) {
  const calls: Array<{ command: string; args: unknown }> = [];
  let refreshed = 0;
  const tasks = createTaskCenter();
  const state = evaluateSource<typeof State>(stateOutput, {
    vue: Vue,
    "@tauri-apps/api/core": {
      invoke: async () => {
        refreshed++;
        return getSnapshot ? getSnapshot() : state.synchronizationSnapshot.value;
      },
    },
    "@/shared/tasks/state": { tasks },
  });
  const snapshot = state.synchronizationSnapshot;
  const scan = evaluateSource<{ useLibrarySynchronization: typeof useLibrarySynchronization }>(
    output,
    {
      vue: Vue,
      "@tauri-apps/api/core": {
        isTauri: () => supported,
        invoke: (command: string, args: unknown) => {
          calls.push({ command, args });
          return invoke();
        },
      },
      "@/features/library/synchronization/state": state,
      "@/shared/notifications/center": { notifications, notify },
      "@/shared/tasks/state": { tasks },
    },
  ).useLibrarySynchronization();
  return {
    scan,
    tasks,
    snapshot,
    calls,
    get refreshed() {
      return refreshed;
    },
  };
}

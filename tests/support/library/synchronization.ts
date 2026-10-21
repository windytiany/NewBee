import * as Vue from "vue";
import { transpileScript, evaluateSource } from "../module/loader";
import { notifications, notify } from "@/shared/notifications/center";
import type { IngestResult } from "@/features/library/types";
import type { SynchronizationSnapshot } from "@/features/library/synchronization/types";
import type { useLibrarySynchronization } from "@/features/library/synchronization/useScan";

const output = transpileScript(
  await Bun.file("src/features/library/synchronization/useScan.ts").text(),
);
export function createSynchronization(invoke: () => Promise<IngestResult>, supported = true) {
  const snapshot = Vue.ref<SynchronizationSnapshot>({ progress: null, statuses: [], missing: [] });
  const calls: Array<{ command: string; args: unknown }> = [];
  let refreshed = 0;
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
      "@/features/library/synchronization/state": {
        synchronizationSnapshot: snapshot,
        refreshSynchronization: async () => {
          refreshed++;
        },
      },
      "@/shared/notifications/center": { notifications, notify },
    },
  ).useLibrarySynchronization();
  return {
    scan,
    snapshot,
    calls,
    get refreshed() {
      return refreshed;
    },
  };
}

import { invoke } from "@tauri-apps/api/core";
import { tasks } from "@/shared/tasks/state";
import { operationId } from "@/shared/logging/logger";
import { watchActivity } from "@/shared/lifecycle/activity";
import { computed, shallowRef } from "vue";
import { t } from "@/shared/i18n/locale";

export type TaskRevision = { trackId: number; value: string };
type Request = {
  id?: string;
  key?: string;
  message: string;
  fingerprint: string;
  trackIds?: readonly number[];
  paths?: readonly string[];
  expected?: readonly TaskRevision[];
  cancel?: () => void | Promise<void>;
};
export class TaskCancelled extends Error {
  constructor() {
    super(t("任务已取消"));
  }
}

export function createWriteQueue(
  command: typeof invoke,
  center: Pick<typeof tasks, "update" | "finish" | "items">,
) {
  const entries = shallowRef<{ id: string; key: string; fingerprint: string }[]>([]);
  const active = computed(() => entries.value.length > 0);
  let tail: Promise<unknown> = Promise.resolve();
  let registration: Promise<unknown> = Promise.resolve();
  let restoring = false;
  let runningId: string | null = null;
  const cancelledIds = new Set<string>();

  async function run<T>(request: Request, execute: (id: string) => Promise<T>): Promise<T> {
    if (restoring) throw new Error(t("正在恢复备份"));
    const duplicate = entries.value.find((entry) => entry.fingerprint === request.fingerprint);
    if (duplicate) {
      globalThis.window?.dispatchEvent(
        new CustomEvent("newbee:task-focus", { detail: duplicate.key }),
      );
      throw new Error(t("任务已在队列中"));
    }
    const trackIds = [...(request.trackIds ?? [])];
    const paths = [...(request.paths ?? [])];
    const expected = (request.expected ?? []).map((revision) => ({ ...revision }));
    const id = request.id ?? operationId("task");
    const key = request.key ?? id;
    let cancelled = false;
    let started = false;
    let wakeCancellation: () => void = () => {};
    const cancellationRequested = new Promise<void>((resolve) => {
      wakeCancellation = resolve;
    });
    let cancellation: Promise<void> = Promise.resolve();
    let cancellationFailure: unknown;
    const report = () => {
      const previous = center.items.value.find((task) => task.key === key && !task.result);
      center.update({
        key,
        message: request.message,
        completed: previous?.completed ?? 0,
        total: previous?.total,
        phase: cancelled ? "cancelling" : started ? "running" : "queued",
        cancel: () => {
          if (cancelled) return;
          cancelled = true;
          cancelledIds.add(id);
          if (cancelledIds.size > 100) cancelledIds.delete(cancelledIds.values().next().value!);
          wakeCancellation();
          report();
          cancellation = reserved
            .then(
              async (duplicate) => {
                if (duplicate) return;
                await command("cancel_task", { id });
                if (started) await request.cancel?.();
              },
              () => undefined,
            )
            .catch((error: unknown) => {
              cancellationFailure = error;
            });
        },
        cancelling: cancelled,
      });
    };
    entries.value = [...entries.value, { id, key, fingerprint: request.fingerprint }];
    const reserved = registration.then(() =>
      command<string | null>("reserve_task", {
        id,
        fingerprint: request.fingerprint,
        trackIds,
        paths,
        expected,
      }),
    );
    registration = reserved.catch(() => undefined);
    // A rejected reservation must not become unhandled while an earlier task is running.
    void reserved.catch(() => undefined);
    report();
    const previous = tail;
    const completion = (async () => {
      let registered = false;
      try {
        const duplicate = await reserved;
        if (duplicate) {
          globalThis.window?.dispatchEvent(
            new CustomEvent("newbee:task-focus", { detail: duplicate }),
          );
          throw new Error(t("任务已在队列中"));
        }
        registered = true;
        // Queued cancellation does not have to wait for earlier work to finish.
        await Promise.race([previous, cancellationRequested]);
        if (cancelled) throw new TaskCancelled();
        await command("start_task", { id });
        if (cancelled) throw new TaskCancelled();
        started = true;
        runningId = id;
        report();
        const result = await execute(id);
        await cancellation;
        if (cancellationFailure) throw cancellationFailure;
        if (cancelled) center.finish(key, { type: "warning", message: t("任务已取消") });
        else center.finish(key);
        return result;
      } catch (error) {
        await cancellation;
        const failure = cancellationFailure ?? error;
        if (failure === "任务已取消" || failure instanceof TaskCancelled) {
          cancelled = true;
          cancelledIds.add(id);
        }
        center.finish(key, {
          type: cancelled && !cancellationFailure ? "warning" : "error",
          message:
            cancelled && !cancellationFailure
              ? t("任务已取消")
              : failure instanceof Error
                ? failure.message
                : String(failure),
        });
        if (cancelled && !cancellationFailure) throw new TaskCancelled();
        throw failure;
      } finally {
        try {
          await cancellation;
        } finally {
          try {
            if (registered) await command("release_task", { id });
          } finally {
            if (runningId === id) runningId = null;
            entries.value = entries.value.filter((entry) => entry.id !== id);
          }
        }
      }
    })();
    tail = Promise.all([previous, completion.catch(() => undefined)]).then(() => undefined);
    return completion;
  }

  async function restore<T>(execute: () => Promise<T>) {
    if (restoring || active.value) throw new Error(t("请等待后台任务结束"));
    restoring = true;
    try {
      return await execute();
    } finally {
      restoring = false;
    }
  }
  return {
    run,
    restore,
    active,
    owns: (id: string) => runningId === id,
    wasCancelled: (id: string) => cancelledIds.has(id),
  };
}

export const writeQueue = createWriteQueue(invoke, tasks);
watchActivity(writeQueue.active);
export const runWriteTask = writeQueue.run;
export async function occupiedTracks(ids: readonly number[]) {
  return invoke<boolean>("occupied_tracks", { trackIds: [...ids] });
}

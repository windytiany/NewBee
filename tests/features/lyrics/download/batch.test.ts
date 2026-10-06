import { describe, expect, it } from "bun:test";
import { createLyricsBatch } from "@/features/lyrics/download/batch";
import type { LyricsBatchOptions } from "@/features/lyrics/download/batch";
import type {
  LyricsBatchEvent,
  LyricsBatchOutcome,
  LyricsBatchSummary,
  LyricsContent,
} from "@/features/lyrics/types";
import type { TagSaveResult } from "@/features/tags/types";
import type { NotificationInput, TaskNotification } from "@/shared/notifications/center";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function saved(trackId: number, success = true): TagSaveResult {
  return {
    trackId,
    path: `${trackId}.mp3`,
    fileWritten: true,
    databaseUpdated: success,
    error: success ? null : "数据库同步失败",
  };
}
function summary(
  results: LyricsBatchOutcome[] = [],
  status: LyricsBatchSummary["status"] = "completed",
  error: string | null = null,
): LyricsBatchSummary {
  return { batchId: 1, status, results, error };
}
async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

// Only the frontend seam is substituted here; Rust tests exercise the real task and write guard.
function setup(
  overrides: Partial<LyricsBatchOptions> = {},
  lookup: (id: number) => Promise<LyricsContent> = async (id) => ({
    kind: "available",
    text: `lyrics ${id}`,
  }),
) {
  const begun: number[][] = [];
  const committed: number[] = [];
  const completed: Array<[number, string | null]> = [];
  const cancelled: number[] = [];
  const messages: NotificationInput[] = [];
  const tasks = new Map<string, TaskNotification>();
  let synchronized = 0;
  let cancelling = false;
  let current: {
    trackId: number;
    stepId: number;
    content: "available" | "instrumental";
    result: TagSaveResult | null;
    committing: boolean;
    done: ReturnType<typeof deferred<string | null>>;
  } | null = null;
  const batch = createLyricsBatch({
    run: async (ids, receive) => {
      begun.push(ids);
      cancelling = false;
      receive({ kind: "started", batchId: 1, total: ids.length });
      const results: LyricsBatchOutcome[] = [];
      for (const [index, trackId] of ids.entries()) {
        if (cancelling) break;
        let outcome: LyricsBatchOutcome;
        try {
          const content = await lookup(trackId);
          if (cancelling) break;
          if (content.kind === "missing")
            outcome = { trackId, kind: "missing", result: null, error: null };
          else {
            current = {
              trackId,
              stepId: index + 1,
              content: content.kind,
              result: null,
              committing: false,
              done: deferred(),
            };
            receive({
              kind: "saveRequested",
              batchId: 1,
              stepId: current.stepId,
              trackId,
              path: `${trackId}.mp3`,
              content: content.kind,
            });
            const error = await current.done.promise;
            if (cancelling && !current.result) break;
            outcome = { trackId, kind: content.kind, result: current.result, error };
            current = null;
          }
        } catch (error) {
          outcome = { trackId, kind: "failed", result: null, error: String(error) };
        }
        results.push(outcome);
        receive({ kind: "trackCompleted", batchId: 1, outcome });
      }
      return summary(results, cancelling ? "cancelled" : "completed");
    },
    commitStep: async (_batchId, stepId) => {
      if (!current || current.stepId !== stepId || cancelling) throw new Error("expired step");
      current.committing = true;
      committed.push(current.trackId);
      current.result = saved(current.trackId);
      return current.result;
    },
    completeStep: async (_batchId, stepId, error) => {
      completed.push([stepId, error]);
      current?.done.resolve(error);
    },
    cancel: async (batchId) => {
      cancelled.push(batchId);
      cancelling = true;
      if (current && !current.committing) current.done.resolve(null);
    },
    editFiles: (_ids, save) => save(),
    synchronize: () => {
      synchronized++;
    },
    notifications: {
      notify: (input) => {
        messages.push(input);
        return 1;
      },
      updateTask: (task) => {
        tasks.set(task.key, task);
      },
      removeTask: (key) => {
        tasks.delete(key);
      },
    },
    ...overrides,
  });
  return {
    batch,
    begun,
    committed,
    completed,
    cancelled,
    messages,
    tasks,
    synchronized: () => synchronized,
  };
}

function started(receive: (event: LyricsBatchEvent) => void) {
  receive({ kind: "started", batchId: 1, total: 1 });
  receive({
    kind: "saveRequested",
    batchId: 1,
    stepId: 1,
    trackId: 1,
    path: "1.mp3",
    content: "available",
  });
}

describe("lyrics batch", () => {
  it("deduplicates targets, commits each request and synchronizes once after the terminal result", async () => {
    const result = setup();
    await result.batch.startTracks([1, 2, 1]);
    expect(result.begun).toEqual([[1, 2]]);
    expect(result.committed).toEqual([1, 2]);
    expect(result.completed).toEqual([
      [1, null],
      [2, null],
    ]);
    expect(result.batch.state.written).toBe(2);
    expect(result.synchronized()).toBe(1);
    expect(result.tasks.size).toBe(0);
    expect(result.batch.state.running).toBe(false);
  });

  it("awaits synchronization before removing the task and closing frontend state", async () => {
    const began = deferred<void>();
    const refresh = deferred<void>();
    const result = setup({
      synchronize: () => {
        began.resolve();
        return refresh.promise;
      },
    });
    const running = result.batch.startTracks([1]);
    await began.promise;
    expect(result.batch.state.running).toBe(true);
    expect(result.tasks.size).toBe(1);
    refresh.resolve();
    await running;
    expect(result.tasks.size).toBe(0);
    expect(result.batch.state.running).toBe(false);
  });

  it("keeps downloads outside playback editing and edits all instrumental marks without snapshot reads", async () => {
    let editing = false;
    const edits: number[][] = [];
    const result = setup(
      {
        editFiles: async (ids, save) => {
          edits.push([...ids]);
          editing = true;
          try {
            return await save();
          } finally {
            editing = false;
          }
        },
      },
      async (id) => {
        expect(editing).toBe(false);
        return id === 1 ? { kind: "available", text: "lyrics" } : { kind: "instrumental" };
      },
    );
    await result.batch.startTracks([1, 2, 3]);
    expect(edits).toEqual([[1], [2], [3]]);
    expect(result.batch.state.instrumental).toBe(2);
    expect(result.batch.state.updated).toBe(3);
    expect(result.synchronized()).toBe(1);
  });

  it("leaves missing and lookup failures untouched and preserves distinct outcomes", async () => {
    const result = setup({}, async (id) => {
      if (id === 1) return { kind: "missing" };
      if (id === 2) return { kind: "instrumental" };
      if (id === 3) throw new Error("lookup timeout");
      return { kind: "available", text: "lyrics" };
    });
    await result.batch.startTracks([1, 2, 3, 4]);
    expect(result.committed).toEqual([2, 4]);
    expect(result.batch.state.missing).toBe(1);
    expect(result.batch.state.failed).toBe(1);
    expect(result.batch.state.instrumental).toBe(1);
    expect(result.messages[0]?.message).toContain("lookup timeout");
  });

  it("rejects playback preparation explicitly without committing and continues later requests", async () => {
    const result = setup({
      editFiles: async () => {
        throw new Error("cannot release playback");
      },
    });
    await result.batch.startTracks([1, 2]);
    expect(result.committed).toEqual([]);
    expect(result.completed).toEqual([
      [1, "cannot release playback"],
      [2, "cannot release playback"],
    ]);
    expect(result.batch.state.failed).toBe(2);
    expect(result.synchronized()).toBe(0);
  });

  it("acknowledges playback cleanup only after editing has ended", async () => {
    const done = deferred<void>();
    const cleanup = deferred<void>();
    const result = setup({
      editFiles: async (_ids, save) => {
        const value = await save();
        done.resolve();
        await cleanup.promise;
        return value;
      },
    });
    const running = result.batch.startTracks([1, 2]);
    await done.promise;
    expect(result.committed).toEqual([1]);
    expect(result.completed).toEqual([]);
    cleanup.resolve();
    await running;
    expect(result.completed).toEqual([
      [1, null],
      [2, null],
    ]);
  });

  it("preserves saved results when playback cleanup fails", async () => {
    const result = setup({
      editFiles: async (_ids, save) => {
        await save();
        throw new Error("status refresh failed");
      },
    });
    await result.batch.startTracks([1]);
    expect(result.batch.state.written).toBe(1);
    expect(result.batch.state.updated).toBe(1);
    expect(result.batch.state.failed).toBe(1);
    expect(result.completed).toEqual([[1, "status refresh failed"]]);
    expect(result.synchronized()).toBe(1);
  });

  it("cancels an in-flight download without authorizing its late result", async () => {
    const request = deferred<LyricsContent>();
    const result = setup({}, () => request.promise);
    const running = result.batch.startTracks([1, 2]);
    await settle();
    result.batch.cancel();
    expect(result.batch.state.running).toBe(true);
    expect(result.batch.state.cancelling).toBe(true);
    request.resolve({ kind: "available", text: "late" });
    await running;
    expect(result.committed).toEqual([]);
    expect(result.cancelled).toEqual([1]);
    expect(result.messages[0]?.message).toContain("已取消");
  });

  it("cancels before the started event by forwarding the request once the batch ID arrives", async () => {
    const begin = deferred<void>();
    const end = deferred<LyricsBatchSummary>();
    const result = setup({
      run: async (_ids, receive) => {
        await begin.promise;
        receive({ kind: "started", batchId: 1, total: 1 });
        return end.promise;
      },
    });
    const running = result.batch.startTracks([1]);
    result.batch.cancel();
    expect(result.cancelled).toEqual([]);
    begin.resolve();
    await settle();
    expect(result.cancelled).toEqual([1]);
    end.resolve(summary([], "cancelled"));
    await running;
  });

  it("never authorizes after cancellation during playback preparation", async () => {
    const preparing = deferred<void>();
    const release = deferred<void>();
    const result = setup({
      editFiles: async (_ids, save) => {
        preparing.resolve();
        await release.promise;
        return save();
      },
    });
    const running = result.batch.startTracks([1]);
    await preparing.promise;
    result.batch.cancel();
    await running;
    release.resolve();
    await settle();
    expect(result.committed).toEqual([]);
    expect(result.batch.state.failed).toBe(0);
  });

  it("waits for accepted commits and editing cleanup after cancellation", async () => {
    const committing = deferred<void>();
    const response = deferred<TagSaveResult>();
    const complete = deferred<LyricsBatchSummary>();
    const calls: string[] = [];
    const result = setup({
      run: async (_ids, receive) => {
        started(receive);
        return complete.promise;
      },
      commitStep: () => {
        committing.resolve();
        return response.promise;
      },
      completeStep: async (_id, _step, error) => {
        calls.push("complete");
        expect(error).toBeNull();
        complete.resolve(
          summary([{ trackId: 1, kind: "available", result: saved(1), error: null }], "cancelled"),
        );
      },
    });
    const running = result.batch.startTracks([1, 2]);
    await committing.promise;
    result.batch.cancel();
    expect(result.batch.state.running).toBe(true);
    response.resolve(saved(1));
    await running;
    expect(calls).toEqual(["complete"]);
    expect(result.batch.state.written).toBe(1);
    expect(result.synchronized()).toBe(1);
  });

  it("calibrates duplicate and missing progress with the final authoritative summary", async () => {
    const outcomes: LyricsBatchOutcome[] = [
      { trackId: 1, kind: "available", result: saved(1), error: null },
      { trackId: 2, kind: "instrumental", result: saved(2), error: null },
    ];
    const result = setup({
      run: async (_ids, receive) => {
        receive({ kind: "started", batchId: 1, total: 2 });
        for (let index = 0; index < 2; index++)
          receive({ kind: "trackCompleted", batchId: 1, outcome: outcomes[0]! });
        return summary(outcomes);
      },
    });
    await result.batch.startTracks([1, 2]);
    expect(result.batch.state.completed).toBe(2);
    expect(result.batch.state.written).toBe(1);
    expect(result.batch.state.instrumental).toBe(1);
    expect(result.batch.state.updated).toBe(2);
  });

  it("retains reported results on terminal response failure without treating unprocessed tracks as failures", async () => {
    const result = setup({
      run: async (_ids, receive) => {
        receive({ kind: "started", batchId: 1, total: 2 });
        receive({
          kind: "trackCompleted",
          batchId: 1,
          outcome: { trackId: 1, kind: "available", result: saved(1), error: null },
        });
        throw new Error("IPC disconnected");
      },
    });
    await result.batch.startTracks([1, 2]);
    expect(result.batch.state.written).toBe(1);
    expect(result.batch.state.failed).toBe(0);
    expect(result.synchronized()).toBe(1);
    expect(result.messages[0]?.message).toContain("IPC disconnected");
  });

  it("reconciles saves confirmed by the terminal response even when commit replies failed", async () => {
    const completed = deferred<void>();
    const result = setup({
      run: async (_ids, receive) => {
        started(receive);
        await completed.promise;
        return summary([{ trackId: 1, kind: "available", result: saved(1), error: null }]);
      },
      commitStep: async () => {
        throw new Error("reply lost");
      },
      completeStep: async () => {
        completed.resolve();
      },
    });
    await result.batch.startTracks([1]);
    expect(result.batch.state.written).toBe(1);
    expect(result.batch.state.failed).toBe(0);
    expect(result.synchronized()).toBe(1);
  });

  it("reports partial saves and refreshes written files despite database failures", async () => {
    const result = setup({
      run: async () =>
        summary([{ trackId: 1, kind: "available", result: saved(1, false), error: null }]),
    });
    await result.batch.startTracks([1]);
    expect(result.batch.state.written).toBe(1);
    expect(result.batch.state.failed).toBe(1);
    expect(result.messages[0]?.type).toBe("warning");
    expect(result.synchronized()).toBe(1);
  });

  it("retries synchronization without running or committing another batch", async () => {
    let attempts = 0;
    const result = setup({
      synchronize: async () => {
        if (++attempts === 1) throw new Error("reload failed");
      },
    });
    await result.batch.startTracks([1]);
    expect(result.batch.state.synchronizationError).toContain("reload failed");
    await result.batch.retrySynchronization();
    expect(result.batch.state.synchronizationError).toBe("");
    expect(result.begun).toEqual([[1]]);
    expect(result.committed).toEqual([1]);
  });

  it("ignores duplicate, wrong-batch and late save messages", async () => {
    let receive!: (event: LyricsBatchEvent) => void;
    const complete = deferred<void>();
    const commits: number[] = [];
    const result = setup({
      run: async (_ids, callback) => {
        receive = callback;
        started(receive);
        receive({
          kind: "saveRequested",
          batchId: 1,
          stepId: 1,
          trackId: 1,
          path: "1.mp3",
          content: "available",
        });
        receive({
          kind: "saveRequested",
          batchId: 9,
          stepId: 2,
          trackId: 2,
          path: "2.mp3",
          content: "available",
        });
        await complete.promise;
        return summary([{ trackId: 1, kind: "available", result: saved(1), error: null }]);
      },
      commitStep: async (_id, step) => {
        commits.push(step);
        return saved(1);
      },
      completeStep: async () => {
        complete.resolve();
      },
    });
    await result.batch.startTracks([1]);
    started(receive);
    await settle();
    expect(commits).toEqual([1]);
  });

  it("does not let expired frontend preparation authorize or mutate a later batch", async () => {
    const release = deferred<void>();
    const terminal = deferred<LyricsBatchSummary>();
    let runs = 0;
    let commits = 0;
    const result = setup({
      run: async (_ids, receive) => {
        if (++runs === 1) {
          started(receive);
          return terminal.promise;
        }
        return summary([{ trackId: 2, kind: "missing", result: null, error: null }]);
      },
      editFiles: async (_ids, save) => {
        await release.promise;
        return save();
      },
      commitStep: async () => {
        commits++;
        return saved(1);
      },
    });
    const running = result.batch.startTracks([1]);
    await settle();
    terminal.resolve(summary([], "failed", "协作超时"));
    await running;
    await result.batch.startTracks([2]);
    release.resolve();
    await settle();
    expect(commits).toBe(0);
    expect(result.batch.state.missing).toBe(1);
    expect(result.batch.state.failed).toBe(0);
    expect(result.messages).toHaveLength(2);
  });

  it("rejects duplicate starts and cleans up start failures", async () => {
    const lookup = deferred<LyricsContent>();
    const result = setup({}, () => lookup.promise);
    const running = result.batch.startTracks([1]);
    await result.batch.startTracks([2]);
    lookup.resolve({ kind: "missing" });
    await running;
    expect(result.begun).toEqual([[1]]);
    const failed = setup({
      run: async () => {
        throw new Error("write task busy");
      },
    });
    await failed.batch.startTracks([1]);
    expect(failed.batch.state.running).toBe(false);
    expect(failed.tasks.size).toBe(0);
    expect(failed.messages[0]?.message).toBe("write task busy");
  });
});

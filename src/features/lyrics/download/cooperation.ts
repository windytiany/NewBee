import { createMetadataSave } from "@/features/tags/save";
import type { MetadataFileEditor } from "@/features/tags/save";
import type { TagSaveResult } from "@/features/tags/types";
import type {
  LyricsBatchEvent,
  LyricsBatchOutcome,
  LyricsBatchSummary,
} from "@/features/lyrics/types";

export type LyricsBatchCooperationOptions = {
  run: (
    trackIds: number[],
    receive: (event: LyricsBatchEvent) => void,
    operationId: string,
  ) => Promise<LyricsBatchSummary>;
  commitStep: (batchId: number, stepId: number) => Promise<TagSaveResult>;
  completeStep: (batchId: number, stepId: number, error: string | null) => Promise<void>;
  cancel: (batchId: number) => Promise<void>;
  editFiles: MetadataFileEditor;
};

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// One instance per run owns frontend permissions, cancellation and late-message rejection.
export function createLyricsBatchCooperation(
  options: LyricsBatchCooperationOptions,
  progress: {
    operationId: string;
    started: (total: number, batchId: number) => void;
    outcome: (outcome: LyricsBatchOutcome) => void;
  },
) {
  let activeBatchId: number | null = null;
  let accepting = true;
  let cancelling = false;
  let cancellationSent = false;
  let cancellationError = "";
  let cooperationError = "";
  const handledSteps = new Set<number>();

  async function sendCancellation() {
    if (!accepting || activeBatchId === null || cancellationSent) return;
    cancellationSent = true;
    try {
      await options.cancel(activeBatchId);
    } catch (error) {
      if (accepting) cancellationError = `取消请求失败：${message(error)}`;
    }
  }
  function cancel() {
    cancelling = true;
    void sendCancellation();
  }
  async function save(event: Extract<LyricsBatchEvent, { kind: "saveRequested" }>) {
    if (!accepting || cancelling) return;
    // Isolated save state lets terminal results close a run without waiting on expired preparation.
    const saving = createMetadataSave({ editFiles: options.editFiles, synchronize: () => {} });
    let confirmed: TagSaveResult | null = null;
    await saving.run({
      operationId: progress.operationId,
      targets: [{ trackId: event.trackId, path: event.path }],
      writeTrackIds: [event.trackId],
      deferSynchronization: true,
      execute: async () => {
        if (!accepting || cancelling) throw new Error("歌词保存请求已结束或取消");
        confirmed = await options.commitStep(event.batchId, event.stepId);
        if (accepting)
          progress.outcome({
            trackId: event.trackId,
            kind: event.content,
            result: confirmed,
            error: null,
          });
        return [confirmed];
      },
    });
    if (!accepting) return;
    if (confirmed && saving.state.error)
      progress.outcome({
        trackId: event.trackId,
        kind: event.content,
        result: confirmed,
        error: saving.state.error,
      });
    if (cancelling && !confirmed) return;
    await options.completeStep(event.batchId, event.stepId, saving.state.error || null);
  }
  async function handleSave(event: Extract<LyricsBatchEvent, { kind: "saveRequested" }>) {
    try {
      await save(event);
    } catch (error) {
      if (accepting) cooperationError = `歌词保存协作失败：${message(error)}`;
    }
  }
  function receive(event: LyricsBatchEvent) {
    if (!accepting) return;
    if (event.kind === "started") {
      if (activeBatchId !== null) return;
      activeBatchId = event.batchId;
      if (cancelling) void sendCancellation();
      progress.started(event.total, event.batchId);
    } else if (event.batchId === activeBatchId) {
      if (event.kind === "trackCompleted") progress.outcome(event.outcome);
      else if (!handledSteps.has(event.stepId)) {
        handledSteps.add(event.stepId);
        void handleSave(event);
      }
    }
  }
  async function run(trackIds: number[]) {
    try {
      return await options.run(trackIds, receive, progress.operationId);
    } catch (error) {
      throw new Error(
        [message(error), cancellationError, cooperationError].filter(Boolean).join("\n"),
        { cause: error },
      );
    } finally {
      accepting = false;
    }
  }
  return { run, cancel };
}

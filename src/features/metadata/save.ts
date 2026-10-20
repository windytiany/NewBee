import { t } from "@/shared/i18n/locale";
import { reactive } from "vue";
import { watchActivity } from "@/shared/lifecycle/activity";
import { notify } from "@/shared/notifications/center";
import { logger, operationId } from "@/shared/logging/logger";
import { createFailures } from "@/shared/logging/aggregation";
import type { MetadataSaveResult } from "@/features/metadata/types";

export function metadataSaved(result: MetadataSaveResult): boolean {
  return result.databaseUpdated;
}

export type MetadataFileEditor = <Result>(
  trackIds: readonly number[],
  save: () => Promise<Result>,
) => Promise<Result>;

type SaveTarget = { trackId: number; path: string };
type SaveRequest = {
  operationId?: string;
  targets: readonly SaveTarget[];
  writeTrackIds: readonly number[];
  prepareWriteTrackIds?: (
    progress: (result: MetadataSaveResult) => void,
  ) => Promise<readonly number[]>;
  execute: (
    progress: (result: MetadataSaveResult) => void,
    operationId: string,
  ) => Promise<MetadataSaveResult[]>;
  deferSynchronization?: boolean;
  reportFailures?: boolean;
};
type MetadataSaveOptions = {
  editFiles: MetadataFileEditor;
  synchronize: (trackIds: number[]) => void | Promise<void>;
  refreshWrittenFiles?: boolean;
  notifyResult?: boolean;
};

export function createMetadataSave(options: MetadataSaveOptions) {
  const state = reactive({
    saving: false,
    results: [] as MetadataSaveResult[],
    completed: 0,
    total: 0,
    error: "",
    synchronizationError: "",
  });
  watchActivity(() => state.saving);
  const pendingSynchronization = new Set<number>();

  function reset() {
    if (state.saving) return;
    pendingSynchronization.clear();
    Object.assign(state, {
      results: [],
      completed: 0,
      total: 0,
      error: "",
      synchronizationError: "",
    });
  }

  async function synchronize(id: string) {
    if (!pendingSynchronization.size) return;
    try {
      await options.synchronize([...pendingSynchronization]);
      logger.info("metadata", "synchronization_completed", {
        operationId: id,
        count: pendingSynchronization.size,
      });
      pendingSynchronization.clear();
      state.synchronizationError = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("metadata", "synchronization_failed", error, { operationId: id });
      state.synchronizationError = t("元数据已保存，但界面刷新失败：{error}", { error: message });
    }
  }

  async function run(request: SaveRequest) {
    if (state.saving) throw new Error(t("元数据保存尚未完成，请稍后重试。"));
    const id = request.operationId ?? operationId("metadata-save");
    logger.debug("metadata", "save_started", { operationId: id, count: request.targets.length });
    const failures = createFailures("metadata", "save_failure", id);
    const targets = new Map(request.targets.map((target) => [target.trackId, target]));
    const results = new Map(state.results.map((result) => [result.trackId, result]));
    const reported = new Map<number, MetadataSaveResult>();

    state.saving = true;
    state.error = "";
    state.completed = 0;
    state.total = targets.size;
    let accepting = true;
    const progress = (result: MetadataSaveResult) => {
      if (!accepting || !targets.has(result.trackId)) return;
      result = {
        ...result,
        fileWritten: result.fileWritten || (results.get(result.trackId)?.fileWritten ?? false),
      };
      results.set(result.trackId, result);
      const previous = reported.get(result.trackId);
      if (
        request.reportFailures !== false &&
        !metadataSaved(result) &&
        (previous?.error !== result.error || previous?.databaseUpdated !== result.databaseUpdated)
      ) {
        failures.record(
          result.error || "Metadata save failed",
          result.path || String(result.trackId),
          {
            stage: result.fileWritten ? "database" : "write",
            fileWritten: result.fileWritten,
            databaseUpdated: result.databaseUpdated,
          },
        );
      }
      reported.set(result.trackId, result);
      state.results = [...results.values()];
      state.completed = reported.size;
    };
    try {
      const writeIds = [
        ...new Set(
          request.prepareWriteTrackIds
            ? await request.prepareWriteTrackIds(progress)
            : request.writeTrackIds,
        ),
      ].filter((id) => targets.has(id));
      const execute = async () => {
        for (const result of await request.execute(progress, id)) progress(result);
      };
      await (writeIds.length ? options.editFiles(writeIds, execute) : execute());
    } catch (error) {
      logger.error("metadata", "save_request_failed", error, { operationId: id });
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      accepting = false;
      for (const target of targets.values()) {
        const result = reported.get(target.trackId) ?? {
          ...target,
          fileWritten: results.get(target.trackId)?.fileWritten ?? false,
          databaseUpdated: false,
          error: state.error || t("保存未返回结果，请重试或重新扫描。"),
        };
        if (
          request.reportFailures !== false &&
          !reported.has(target.trackId) &&
          !metadataSaved(result)
        ) {
          failures.record(result.error, result.path || String(result.trackId), {
            stage: result.fileWritten ? "database" : "write",
            fileWritten: result.fileWritten,
            databaseUpdated: result.databaseUpdated,
          });
        }
        logger.debug("metadata", "save_result", {
          operationId: id,
          trackId: result.trackId,
          path: result.path,
          error: result.error,
          fileWritten: result.fileWritten,
          databaseUpdated: result.databaseUpdated,
        });
        results.set(target.trackId, result);
        reported.set(target.trackId, result);
        if (metadataSaved(result) || (options.refreshWrittenFiles && result.fileWritten)) {
          pendingSynchronization.add(target.trackId);
        }
      }
      state.results = [...results.values()];
      state.completed = targets.size;
      if (!request.deferSynchronization) await synchronize(id);
      failures.flush();
      const succeeded = [...reported.values()].filter((result) => metadataSaved(result)).length;
      const failed = reported.size - succeeded;
      logger.write(
        state.error
          ? "error"
          : state.synchronizationError
            ? "warn"
            : request.reportFailures === false
              ? "debug"
              : failed
                ? "warn"
                : "info",
        "metadata",
        "save_completed",
        {
          operationId: id,
          count: reported.size,
          failed,
          refreshFailed: Boolean(state.synchronizationError),
        },
      );
      if (options.notifyResult && (failed || state.synchronizationError))
        notify({
          type: succeeded ? "warning" : "error",
          message: failed
            ? t("{count} 首曲目保存失败。无法完成写入或同步。", { count: failed })
            : t("元数据已保存，但界面刷新失败。"),
        });
      state.saving = false;
    }
    return [...reported.values()];
  }

  async function retrySynchronization() {
    if (state.saving) return;
    state.saving = true;
    try {
      await synchronize(operationId("metadata-refresh"));
    } finally {
      state.saving = false;
    }
  }

  return { state, run, reset, retrySynchronization };
}

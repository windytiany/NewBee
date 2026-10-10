import { t } from "@/shared/i18n/locale";
import { reactive } from "vue";
import { notify } from "@/shared/notifications/center";
import { logger, operationId } from "@/shared/logging/logger";
import type { TagSaveResult } from "@/features/tags/types";

export type MetadataFileEditor = <Result>(
  trackIds: readonly number[],
  save: () => Promise<Result>,
) => Promise<Result>;

type SaveTarget = { trackId: number; path: string };
type SaveRequest = {
  operationId?: string;
  targets: readonly SaveTarget[];
  writeTrackIds: readonly number[];
  execute: (
    progress: (result: TagSaveResult) => void,
    operationId: string,
  ) => Promise<TagSaveResult[]>;
  deferSynchronization?: boolean;
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
    results: [] as TagSaveResult[],
    completed: 0,
    total: 0,
    error: "",
    synchronizationError: "",
  });
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
      logger.info("tags", "synchronization_completed", {
        operationId: id,
        count: pendingSynchronization.size,
      });
      pendingSynchronization.clear();
      state.synchronizationError = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("tags", "synchronization_failed", error, { operationId: id });
      state.synchronizationError = t("元数据已保存，但界面刷新失败：{error}", { error: message });
    }
  }

  async function run(request: SaveRequest) {
    if (state.saving) throw new Error(t("元数据保存尚未完成，请稍后重试。"));
    const id = request.operationId ?? operationId("metadata-save");
    logger.info("tags", "save_started", { operationId: id, count: request.targets.length });
    const targets = new Map(request.targets.map((target) => [target.trackId, target]));
    const results = new Map(state.results.map((result) => [result.trackId, result]));
    const reported = new Map<number, TagSaveResult>();
    const writeIds = [...new Set(request.writeTrackIds)].filter((id) => targets.has(id));
    state.saving = true;
    state.error = "";
    state.completed = 0;
    state.total = targets.size;
    let accepting = true;
    const progress = (result: TagSaveResult) => {
      if (!accepting || !targets.has(result.trackId)) return;
      results.set(result.trackId, result);
      reported.set(result.trackId, result);
      state.results = [...results.values()];
      state.completed = reported.size;
    };
    try {
      const execute = async () => {
        for (const result of await request.execute(progress, id)) progress(result);
      };
      await (writeIds.length ? options.editFiles(writeIds, execute) : execute());
    } catch (error) {
      logger.error("tags", "save_request_failed", error, { operationId: id });
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      accepting = false;
      for (const target of targets.values()) {
        const result = reported.get(target.trackId) ?? {
          ...target,
          fileWritten: false,
          databaseUpdated: false,
          error: state.error || t("保存未返回结果，请重试或重新扫描。"),
        };
        logger.write(result.databaseUpdated ? "info" : "warn", "tags", "save_result", {
          operationId: id,
          trackId: result.trackId,
          path: result.path,
          error: result.error,
          fileWritten: result.fileWritten,
          databaseUpdated: result.databaseUpdated,
        });
        results.set(target.trackId, result);
        reported.set(target.trackId, result);
        if (result.databaseUpdated || (options.refreshWrittenFiles && result.fileWritten)) {
          pendingSynchronization.add(target.trackId);
        }
      }
      state.results = [...results.values()];
      state.completed = targets.size;
      if (!request.deferSynchronization) await synchronize(id);
      logger.info("tags", "save_completed", {
        operationId: id,
        count: reported.size,
        refreshFailed: Boolean(state.synchronizationError),
      });
      const succeeded = [...reported.values()].filter((result) => result.databaseUpdated).length;
      const failed = reported.size - succeeded;
      if (options.notifyResult)
        notify({
          type: failed
            ? succeeded
              ? "warning"
              : "error"
            : state.synchronizationError
              ? "warning"
              : "success",
          message: state.synchronizationError
            ? t("标签保存完成：{count} 首成功，{failed} 首失败。元数据已保存，但界面刷新失败。", {
                count: succeeded,
                failed,
              })
            : t("标签保存完成：{count} 首成功，{failed} 首失败。", { count: succeeded, failed }),
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

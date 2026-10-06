import { reactive } from "vue";
import type { TagSaveResult } from "@/features/tags/types";

export type MetadataFileEditor = <Result>(
  trackIds: readonly number[],
  save: () => Promise<Result>,
) => Promise<Result>;

type SaveTarget = { trackId: number; path: string };
type SaveRequest = {
  targets: readonly SaveTarget[];
  writeTrackIds: readonly number[];
  execute: (progress: (result: TagSaveResult) => void) => Promise<TagSaveResult[]>;
  deferSynchronization?: boolean;
};
type MetadataSaveOptions = {
  editFiles: MetadataFileEditor;
  synchronize: (trackIds: number[]) => void | Promise<void>;
  refreshWrittenFiles?: boolean;
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

  async function synchronize() {
    if (!pendingSynchronization.size) return;
    try {
      await options.synchronize([...pendingSynchronization]);
      pendingSynchronization.clear();
      state.synchronizationError = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.synchronizationError = `元数据已保存，但界面刷新失败：${message}`;
    }
  }

  async function run(request: SaveRequest) {
    if (state.saving) throw new Error("元数据保存尚未完成，请稍后重试。");
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
        for (const result of await request.execute(progress)) progress(result);
      };
      await (writeIds.length ? options.editFiles(writeIds, execute) : execute());
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      accepting = false;
      for (const target of targets.values()) {
        const result = reported.get(target.trackId) ?? {
          ...target,
          fileWritten: false,
          databaseUpdated: false,
          error: state.error || "保存未返回结果，请重试或重新扫描。",
        };
        results.set(target.trackId, result);
        reported.set(target.trackId, result);
        if (result.databaseUpdated || (options.refreshWrittenFiles && result.fileWritten)) {
          pendingSynchronization.add(target.trackId);
        }
      }
      state.results = [...results.values()];
      state.completed = targets.size;
      if (!request.deferSynchronization) await synchronize();
      state.saving = false;
    }
    return [...reported.values()];
  }

  async function retrySynchronization() {
    if (state.saving) return;
    state.saving = true;
    try {
      await synchronize();
    } finally {
      state.saving = false;
    }
  }

  return { state, run, reset, retrySynchronization };
}

import { Channel, invoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import { runWriteTask, writeQueue, type TaskRevision } from "@/features/tasks/queue";
import { tasks } from "@/shared/tasks/state";
import { t } from "@/shared/i18n/locale";

const titles: Record<string, string> = {
  synchronize_library: "正在扫描…",
  scan_library: "正在扫描…",
  import_music_files: "导入音频文件",
  register_inbox: "导入音频文件",
  ingest_inbox: "导入音乐库",
  save_track_metadata: "保存标签",
  save_album_tags: "保存标签",
  analyze_track_loudness: "正在分析 ReplayGain…",
  restore_track_loudness: "正在移除 ReplayGain 标签…",
  export_backup: "导出备份",
};

export function taskCommands(id: string, commandInvoker: typeof invoke = invoke): typeof invoke {
  return <T>(command: string, args?: InvokeArgs, options?: InvokeOptions) => {
    if (args instanceof Uint8Array || args instanceof ArrayBuffer || Array.isArray(args))
      return commandInvoker<T>(command, args, options);
    return commandInvoker<T>(command, { ...args, operationId: id }, options);
  };
}

export async function taskInvoke<T>(
  command: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
): Promise<T> {
  if (command === "restore_backup")
    return writeQueue.restore(() => invoke<T>(command, args, options));
  const title = titles[command];
  if (
    !title ||
    !args ||
    args instanceof Uint8Array ||
    args instanceof ArrayBuffer ||
    Array.isArray(args)
  )
    return invoke<T>(command, args, options);
  const values = args as Record<string, unknown>;
  const request = (values.request ?? values) as Record<string, unknown>;
  const patches = values.patches as { trackId: number }[] | undefined;
  const trackIds = [
    ...((request.trackIds ?? patches?.map((patch) => patch.trackId) ?? []) as number[]),
  ];
  const paths = [...((values.paths ?? []) as string[])];
  const fingerprint = JSON.stringify([
    command,
    request.trackIds
      ? { ...request, onProgress: undefined, operationId: undefined }
      : { ...values, onProgress: undefined, operationId: undefined },
  ]);
  // Capture the submitted payload; later edits must not mutate queued arguments.
  const snapshot = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value instanceof Channel || value === undefined ? value : JSON.parse(JSON.stringify(value)),
    ]),
  );
  const key = ["synchronize_library", "scan_library"].includes(command)
    ? "library-synchronization"
    : undefined;
  const execute = async (id: string) => {
    if (key) tasks.update({ key, message: t(title), completed: 0, phase: "running" });
    const channel = snapshot.onProgress;
    let restoreProgress = () => {};
    if (channel instanceof Channel) {
      const receive = channel.onmessage;
      restoreProgress = () => {
        channel.onmessage = receive;
      };
      let completed = 0;
      channel.onmessage = (value: { completed?: number; total?: number }) => {
        receive(value);
        tasks.update({
          key: key ?? id,
          message: t(title),
          completed: value.completed ?? ++completed,
          total: value.total ?? (trackIds.length || paths.length || undefined),
        });
      };
    }
    try {
      const result = await taskCommands(id)<T>(command, snapshot, options);
      const failures = Array.isArray(result)
        ? result.filter(
            (entry) =>
              entry.error ||
              entry.success === false ||
              (typeof entry.trackId === "number" && entry.databaseUpdated === false),
          )
        : [];
      const failed =
        failures.length ||
        (result &&
        typeof result === "object" &&
        "failed" in result &&
        typeof result.failed === "number"
          ? result.failed
          : 0);
      if (failed)
        tasks.finish(key ?? id, {
          type: "warning",
          message: t("{count} 项处理失败", { count: failed }),
          details: failures.flatMap((entry) => (entry.error ? [String(entry.error)] : [])),
        });
      return result;
    } finally {
      restoreProgress();
    }
  };
  if (typeof values.operationId === "string" && writeQueue.owns(values.operationId))
    return execute(values.operationId);
  return runWriteTask(
    {
      id: typeof values.operationId === "string" ? values.operationId : undefined,
      key,
      message: t(title),
      fingerprint,
      trackIds,
      paths,
      expected: (values.expected ?? request.expected ?? []) as TaskRevision[],
    },
    execute,
  );
}

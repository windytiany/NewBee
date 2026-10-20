import { describeError, logger } from "@/shared/logging/logger";
import type { LogFields } from "@/shared/logging/logger";

type Group = {
  fields: LogFields;
  attempts: number;
  subjects: Set<string>;
  samples: string[];
  reported: number;
  lastReport: number;
};

export function createFailures(
  module: string,
  event: string,
  operationId: string,
  log: Pick<typeof logger, "write"> = logger,
  now = Date.now,
) {
  const groups = new Map<string, Group>();
  function emit(group: Group, phase: string) {
    log.write("warn", module, event, {
      ...group.fields,
      operationId,
      phase,
      attempts: group.attempts,
      affected: group.subjects.size,
      sinceLastReport: group.attempts - group.reported,
      samples: group.samples,
      omittedSamples: group.subjects.size - group.samples.length,
    });
    group.reported = group.attempts;
    group.lastReport = now();
  }
  function flush() {
    for (const group of groups.values()) {
      if (group.reported < group.attempts) emit(group, "summary");
    }
  }
  return {
    record(reason: unknown, subject: string, fields: LogFields = {}) {
      const error = describeError(reason);
      const identity =
        reason instanceof Error ? reason.message : typeof reason === "string" ? reason : error;
      const key = JSON.stringify([
        fields.stage,
        fields.code,
        identity,
        fields.fileWritten,
        fields.databaseUpdated,
      ]);
      if (groups.size >= 128 && !groups.has(key)) {
        flush();
        groups.clear();
      }
      let group = groups.get(key);
      if (!group) {
        group = {
          fields: { ...fields, error },
          attempts: 0,
          subjects: new Set(),
          samples: [],
          reported: 0,
          lastReport: now(),
        };
        groups.set(key, group);
      }
      group.attempts++;
      if (!group.subjects.has(subject) && group.samples.length < 3) group.samples.push(subject);
      group.subjects.add(subject);
      if (!group.reported || now() - group.lastReport >= 30_000)
        emit(group, group.reported ? "progress" : "first");
    },
    flush,
  };
}

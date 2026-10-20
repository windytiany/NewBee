import { expect, it } from "bun:test";
import { createFailures } from "@/shared/logging/aggregation";
import { createLogger } from "@/shared/logging/logger";

it("aggregates different tracks, counts retries, preserves samples and bypasses repeat suppression", () => {
  const records: Array<Record<string, unknown>> = [];
  const logger = createLogger(async (_level, text) => {
    records.push(JSON.parse(text));
  });
  const batch = createFailures("metadata", "save_failed", "save:1", logger);
  for (let index = 0; index < 42; index++)
    batch.record("permission denied", `D:/Music/${index}.flac`);
  batch.record("permission denied", "D:/Music/0.flac");
  expect(records).toHaveLength(1);
  batch.flush();
  expect(records).toHaveLength(2);
  expect(records[1]).toMatchObject({
    phase: "summary",
    attempts: 43,
    affected: 42,
    omittedSamples: 39,
    sinceLastReport: 42,
  });
  expect(records[1]?.samples).toEqual(["D:/Music/0.flac", "D:/Music/1.flac", "D:/Music/2.flac"]);
  batch.flush();
  expect(records).toHaveLength(2);
});

it("separates reasons, stages, partial commits and operations", () => {
  const records: Array<Record<string, unknown>> = [];
  const logger = createLogger(async (_level, text) => {
    records.push(JSON.parse(text));
  });
  const batch = createFailures("metadata", "save_failed", "save:1", logger);
  batch.record("permission denied", "a", { stage: "write" });
  batch.record("disk full", "b", { stage: "write" });
  batch.record("permission denied", "c", { stage: "database" });
  batch.record("permission denied", "d", { stage: "write", fileWritten: true });
  createFailures("metadata", "save_failed", "save:2", logger).record("permission denied", "a", {
    stage: "write",
  });
  expect(records).toHaveLength(5);
});

it("emits periodic progress and the final delta", () => {
  let time = 0;
  const records: Array<Record<string, unknown>> = [];
  const logger = createLogger(
    async (_level, text) => {
      records.push(JSON.parse(text));
    },
    () => time,
  );
  const batch = createFailures("library", "scan_failed", "scan:1", logger, () => time);
  batch.record("bad file", "a");
  time = 30_000;
  batch.record("bad file", "b");
  batch.record("bad file", "c");
  batch.flush();
  expect(records.map((record) => record.phase)).toEqual(["first", "progress", "summary"]);
  expect(records.map((record) => record.sinceLastReport)).toEqual([1, 1, 1]);
});

import { expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateSource } from "../../support/module/loader";
import * as logging from "@/shared/logging/logger";

it("aggregates real batch save failures without duplicating progress and final results", async () => {
  const records: Array<{ level: string; fields: Record<string, unknown> }> = [];
  const logger = logging.createLogger(async (level, text) => {
    records.push({ level, fields: JSON.parse(text) });
  });
  const { createMetadataSave } = evaluateSource<typeof import("@/features/metadata/save")>(
    "module.exports = require('@/features/metadata/save');",
    {
      vue: Vue,
      "@/shared/logging/logger": { ...logging, logger },
    },
  );
  const save = createMetadataSave({
    editFiles: async (_ids, execute) => execute(),
    synchronize: async () => {},
  });
  const results = Array.from({ length: 42 }, (_, index) => ({
    trackId: index + 1,
    path: `D:/Music/${index}.flac`,
    fileWritten: false,
    databaseUpdated: false,
    error: "permission denied",
  }));
  await save.run({
    targets: results,
    writeTrackIds: results.map((result) => result.trackId),
    execute: async (progress) => {
      results.forEach(progress);
      return results;
    },
  });
  const failures = records.filter((record) => record.fields.event === "save_failure");
  expect(failures).toHaveLength(2);
  expect(failures[1]?.fields).toMatchObject({ attempts: 42, affected: 42, omittedSamples: 39 });
  expect(
    records
      .filter((record) => record.fields.event === "save_result")
      .every((record) => record.level === "debug"),
  ).toBe(true);
  expect(records.find((record) => record.fields.event === "save_completed")).toMatchObject({
    level: "warn",
    fields: { failed: 42 },
  });
});

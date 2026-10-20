import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { evaluateModule, transpileScript } from "../../support/module/loader";
import { createLogger, describeError, operationId } from "@/shared/logging/logger";
import type { LogLevel } from "@/shared/logging/logger";

function fixture() {
  let time = 0;
  const records: Array<{ level: LogLevel; fields: Record<string, unknown> }> = [];
  const logger = createLogger(
    async (level, message) => {
      records.push({ level, fields: JSON.parse(message) });
    },
    () => time,
  );
  return {
    logger,
    records,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("diagnostic logging", () => {
  it("sends production frontend logs through the real plugin IPC adapter", async () => {
    const requests: Array<{ command: string; args: Record<string, unknown> }> = [];
    const plugin = evaluateModule<typeof import("@tauri-apps/plugin-log")>(
      transpileScript(readFileSync(new URL(import.meta.resolve("@tauri-apps/plugin-log")), "utf8")),
      {
        "@tauri-apps/api/core": {
          invoke: async (command: string, args: Record<string, unknown>) => {
            requests.push({ command, args });
          },
        },
        "@tauri-apps/api/event": {},
      },
    );
    const { logger } = evaluateModule<typeof import("@/shared/logging/logger")>(
      transpileScript(
        readFileSync(new URL("../../../src/shared/logging/logger.ts", import.meta.url), "utf8"),
      ),
      {
        "@tauri-apps/api/core": { isTauri: () => true },
        "@tauri-apps/plugin-log": plugin,
      },
    );
    logger.debug("app", "debug-marker");
    logger.info("app", "started", { operationId: "startup:1" });
    logger.warn("app", "degraded", "recoverable");
    logger.error("app", "failed", new Error("original failure"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(requests.map(({ command }) => command)).toEqual(Array(4).fill("plugin:log|log"));
    expect(requests.map(({ args }) => args.level)).toEqual([2, 3, 4, 5]);
    expect(JSON.parse(String(requests[1]?.args.message))).toEqual({
      source: "frontend",
      module: "app",
      event: "started",
      operationId: "startup:1",
    });
  });
  it("records module, event and operation without serializing arbitrary rejected objects", () => {
    const { logger, records } = fixture();
    logger.error(
      "tags",
      "save_failed",
      { lyrics: "private text", credentials: "secret" },
      {
        operationId: "save:1",
        trackId: 4,
        fileWritten: true,
        databaseUpdated: false,
        path: "C:/Music/track.flac",
      },
    );
    expect(records[0]).toEqual({
      level: "error",
      fields: {
        source: "frontend",
        module: "tags",
        event: "save_failed",
        operationId: "save:1",
        trackId: 4,
        fileWritten: true,
        databaseUpdated: false,
        path: "C:/Music/track.flac",
        error: "Unknown error",
      },
    });
    expect(JSON.stringify(records)).not.toContain("private text");
    expect(JSON.stringify(records)).not.toContain("secret");
  });

  it("rejects unapproved structured fields at runtime", () => {
    const { logger, records } = fixture();
    const fields = {
      trackId: 1,
      lyrics: "private lyrics",
      token: "credential",
      responseBody: "private response",
    };
    logger.info("lyrics", "test", fields);
    expect(records[0]?.fields.trackId).toBe(1);
    expect(records[0]?.fields.lyrics).toBeUndefined();
    expect(records[0]?.fields.token).toBeUndefined();
    expect(records[0]?.fields.responseBody).toBeUndefined();
  });

  it("redacts recognizable credentials in strings, Error messages, stacks and fields while retaining music paths", () => {
    const { logger, records } = fixture();
    const text = `Authorization: Bearer auth-secret Bearer bare-secret https://alice:url-secret@example.com/music?token=query-secret&api_key=api-secret password="two word secret" {"access_token":"json-secret"} C:/Music/song.flac`;
    const error = new Error(text);
    error.stack = `stack ${text}`;
    logger.error("app", "failed", error, { context: text, path: "C:/Music/song.flac" });
    logger.warn("app", "string", text);
    logger.info("app", "escaped_json", { context: JSON.stringify({ error: text }) });
    const output = JSON.stringify(records);
    for (const secret of [
      "auth-secret",
      "bare-secret",
      "alice",
      "url-secret",
      "query-secret",
      "api-secret",
      "two word secret",
      "json-secret",
    ])
      expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
    expect(records[0]?.fields.path).toBe("C:/Music/song.flac");
    expect(output).toContain("example.com/music");
  });

  it("bounds diagnostic text, including Error messages", () => {
    expect(describeError(new Error("x".repeat(10_000)))).toHaveLength(2_000);
    const { logger, records } = fixture();
    logger.info("app", "test", { context: "x".repeat(10_000) });
    expect(String(records[0]?.fields.context)).toHaveLength(2_000);
  });

  it("does not suppress distinct reasons or paths within the same operation", () => {
    const { logger, records } = fixture();
    logger.warn("library", "scan_failed", "permission denied", {
      operationId: "scan:1",
      path: "a",
    });
    logger.warn("library", "scan_failed", "disk full", { operationId: "scan:1", path: "a" });
    logger.warn("library", "scan_failed", "permission denied", {
      operationId: "scan:1",
      path: "b",
    });
    expect(records).toHaveLength(3);
  });

  it("records structured command codes and details without arbitrary object serialization", () => {
    const { logger, records } = fixture();
    logger.warn("library", "scan_failed", {
      code: "write_busy",
      message: "任务正在运行",
      detail: "lock held",
      private: "secret",
    });
    expect(records[0]?.fields).toMatchObject({ code: "write_busy", error: "lock held" });
    expect(JSON.stringify(records)).not.toContain("secret");
  });

  it("reports the first repeated failure then a periodic suppression count", () => {
    const { logger, records, advance } = fixture();
    logger.warn("playback", "status_failed", "IPC unavailable");
    for (let index = 0; index < 100; index++)
      logger.warn("playback", "status_failed", "IPC unavailable");
    expect(records).toHaveLength(1);
    advance(30_000);
    logger.warn("playback", "status_failed", "IPC unavailable");
    expect(records[1]?.fields.suppressed).toBe(100);
    logger.warn("playback", "status_failed", "IPC unavailable");
    logger.recovered("playback", "status_failed");
    expect(records[2]?.fields.event).toBe("status_failed_recovered");
    expect(records[2]?.fields.suppressed).toBe(1);
    logger.warn("playback", "status_failed", "new failure after recovery");
    expect(records).toHaveLength(4);
  });

  it("never merges per-file results or separate operations", () => {
    const { logger, records } = fixture();
    logger.warn("tags", "save_result", "DB unavailable", { operationId: "save:1", trackId: 1 });
    logger.warn("tags", "save_result", "DB unavailable", { operationId: "save:1", trackId: 2 });
    logger.warn("tags", "save_result", "DB unavailable", { operationId: "save:2", trackId: 1 });
    expect(records).toHaveLength(3);
    expect(operationId("scan")).not.toBe(operationId("scan"));
  });

  it("keeps the suppression cache bounded", () => {
    const { logger, records } = fixture();
    for (let trackId = 0; trackId < 201; trackId++)
      logger.warn("artwork", "read_failed", "bad cover", { trackId });
    logger.warn("artwork", "read_failed", "bad cover", { trackId: 0 });
    expect(records).toHaveLength(202);
  });

  it("does not reject business operations when the sink throws or rejects", async () => {
    const rejected = createLogger(async () => {
      throw new Error("read-only log directory");
    });
    const throwing = createLogger(() => {
      throw new Error("transport unavailable");
    });
    expect(() => rejected.info("app", "started")).not.toThrow();
    expect(() => throwing.error("app", "failure", new Error("original error"))).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
});

import { isTauri } from "@tauri-apps/api/core";
import { debug, info, warn, error } from "@tauri-apps/plugin-log";

export type LogLevel = "debug" | "info" | "warn" | "error";
const FIELD_NAMES = [
  "suppressed",
  "operationId",
  "trackId",
  "playbackId",
  "batchId",
  "playlistId",
  "path",
  "count",
  "kind",
  "elapsedMs",
  "fileWritten",
  "databaseUpdated",
  "stack",
  "error",
  "context",
  "action",
  "issue",
  "cancelled",
  "written",
  "missing",
  "instrumental",
  "failed",
  "added",
  "updated",
  "skipped",
  "refreshFailed",
] as const;
export type LogFields = Partial<
  Record<(typeof FIELD_NAMES)[number], string | number | boolean | null>
>;
const allowedFields = new Set<string>(FIELD_NAMES);
type LogSink = (level: LogLevel, message: string) => Promise<void>;
const sinks = { debug, info, warn, error };
const MAX_TEXT_LENGTH = 2_000;
const REPEAT_WINDOW_MS = 30_000;
const MAX_REPEAT_KEYS = 200;

// Recognizable credential syntax only; ordinary diagnostic text and local paths remain intact.
export function redactText(text: string): string {
  return text
    .replace(
      /(\bAuthorization\s*\\?["']?\s*[:=]\s*\\?["']?)(?:Bearer|Basic)\s+[^\s"',;]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(\bBearer\s+)[^\s"',;]+/gi, "$1[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(
      /(\b(?:token|access_token|refresh_token|api_key|api-key|apikey|password|passwd|client_secret)\b\\?["']?\s*[:=]\s*)(?:\\?"[^"\r\n]*"|\\?'[^'\r\n]*'|[^\s&"',;}]+)/gi,
      "$1[REDACTED]",
    );
}

export function describeError(reason: unknown): string {
  // Do not serialize arbitrary objects: they can contain lyrics, responses or credentials.
  const text =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Unknown error";
  return redactText(text).slice(0, MAX_TEXT_LENGTH);
}

export function createLogger(sink: LogSink, now = Date.now) {
  const recent = new Map<string, { time: number; suppressed: number }>();
  function write(level: LogLevel, module: string, event: string, fields: LogFields = {}) {
    try {
      const key = `${level}:${module}:${event}:${fields.operationId ?? ""}:${fields.trackId ?? ""}`;
      const time = now();
      const previous = recent.get(key);
      if (
        (level === "warn" || level === "error") &&
        previous &&
        time - previous.time < REPEAT_WINDOW_MS
      ) {
        previous.suppressed++;
        return;
      }
      const suppressed = previous?.suppressed ?? 0;
      if (level === "warn" || level === "error") {
        recent.delete(key);
        if (recent.size >= MAX_REPEAT_KEYS) {
          const oldest = recent.keys().next().value;
          if (oldest !== undefined) recent.delete(oldest);
        }
        recent.set(key, { time, suppressed: 0 });
      }
      const safeFields = Object.fromEntries(
        Object.entries(fields)
          .filter(
            ([name, value]) =>
              allowedFields.has(name) &&
              (value == null || ["string", "number", "boolean"].includes(typeof value)),
          )
          .map(([name, value]) => [
            name,
            typeof value === "string" ? redactText(value).slice(0, MAX_TEXT_LENGTH) : value,
          ]),
      );
      const message = JSON.stringify({
        source: "frontend",
        module: redactText(module),
        event: redactText(event),
        ...safeFields,
        ...(suppressed ? { suppressed } : {}),
      });
      // Logging must never reject into the business operation or recurse through error handlers.
      void sink(level, message).catch(() => {});
    } catch {
      /* The sink is unavailable; business operations continue. */
    }
  }
  return {
    write,
    recovered: (module: string, event: string, fields: LogFields = {}) => {
      let suppressed = 0;
      for (const level of ["warn", "error"]) {
        const key = `${level}:${module}:${event}:${fields.operationId ?? ""}:${fields.trackId ?? ""}`;
        suppressed += recent.get(key)?.suppressed ?? 0;
        recent.delete(key);
      }
      write("info", module, `${event}_recovered`, { ...fields, suppressed });
    },
    error: (module: string, event: string, reason?: unknown, fields: LogFields = {}) =>
      write("error", module, event, {
        ...fields,
        error: describeError(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      }),
    warn: (module: string, event: string, reason?: unknown, fields: LogFields = {}) =>
      write("warn", module, event, {
        ...fields,
        error: describeError(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      }),
    info: (module: string, event: string, fields: LogFields = {}) =>
      write("info", module, event, fields),
    debug: (module: string, event: string, fields: LogFields = {}) =>
      write("debug", module, event, fields),
  };
}

export const logger = createLogger((level, message) =>
  isTauri() ? sinks[level](message) : Promise.resolve(),
);
let operationSequence = 0;
export function operationId(module: string) {
  return `${module}:${Date.now()}:${++operationSequence}`;
}

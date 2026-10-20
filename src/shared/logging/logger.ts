import { isTauri } from "@tauri-apps/api/core";
import { debug, info, warn, error } from "@tauri-apps/plugin-log";

export type LogLevel = "debug" | "info" | "warn" | "error";
const FIELD_NAMES = [
  "suppressed",
  "code",
  "stage",
  "attempts",
  "affected",
  "sinceLastReport",
  "omittedSamples",
  "phase",
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
> & { samples?: string[] };
const allowedFields = new Set<string>([...FIELD_NAMES, "samples"]);
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
        : reason &&
            typeof reason === "object" &&
            "code" in reason &&
            typeof reason.code === "string" &&
            "message" in reason &&
            typeof reason.message === "string"
          ? "detail" in reason && typeof reason.detail === "string"
            ? reason.detail
            : reason.message
          : "Unknown error";
  return redactText(text).slice(0, MAX_TEXT_LENGTH);
}

export function createLogger(sink: LogSink, now = Date.now) {
  const recent = new Map<string, { time: number; suppressed: number }>();
  const scopeKey = (level: string, module: string, event: string, fields: LogFields) =>
    JSON.stringify([level, module, event, fields.operationId, fields.trackId, fields.path]) + ":";
  function write(level: LogLevel, module: string, event: string, fields: LogFields = {}) {
    try {
      const key =
        scopeKey(level, module, event, fields) + JSON.stringify([fields.code, fields.error]);
      const time = now();
      const previous = recent.get(key);
      const repeated = (level === "warn" || level === "error") && !fields.phase;
      if (repeated && previous && time - previous.time < REPEAT_WINDOW_MS) {
        previous.suppressed++;
        return;
      }
      const suppressed = previous?.suppressed ?? 0;
      if (repeated) {
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
              (value == null ||
                ["string", "number", "boolean"].includes(typeof value) ||
                (name === "samples" &&
                  Array.isArray(value) &&
                  value.every((item) => typeof item === "string"))),
          )
          .map(([name, value]) => [
            name,
            typeof value === "string"
              ? redactText(value).slice(0, MAX_TEXT_LENGTH)
              : Array.isArray(value)
                ? value.slice(0, 3).map((item) => redactText(item).slice(0, MAX_TEXT_LENGTH))
                : value,
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
        const prefix = scopeKey(level, module, event, fields);
        for (const [key, value] of recent) {
          if (key.startsWith(prefix)) {
            suppressed += value.suppressed;
            recent.delete(key);
          }
        }
      }
      write("info", module, `${event}_recovered`, { ...fields, suppressed });
    },
    error: (module: string, event: string, reason?: unknown, fields: LogFields = {}) =>
      write("error", module, event, {
        ...fields,
        code:
          reason &&
          typeof reason === "object" &&
          "code" in reason &&
          typeof reason.code === "string"
            ? reason.code
            : fields.code,
        error: describeError(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      }),
    warn: (module: string, event: string, reason?: unknown, fields: LogFields = {}) =>
      write("warn", module, event, {
        ...fields,
        code:
          reason &&
          typeof reason === "object" &&
          "code" in reason &&
          typeof reason.code === "string"
            ? reason.code
            : fields.code,
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

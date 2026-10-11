import { afterEach, expect, it } from "bun:test";
import { createLogger } from "@/shared/logging/logger";
import { evaluateSource, transpileScript } from "../support/module/loader";

const output = transpileScript(await Bun.file("src/app/logging.ts").text());
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

it("captures Vue errors, uncaught errors and unhandled rejections without logging response objects", () => {
  const records: Array<Record<string, unknown>> = [];
  const logger = createLogger(async (_level, message) => {
    records.push(JSON.parse(message));
  });
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: (name: string, callback: (event: Record<string, unknown>) => void) =>
        listeners.set(name, callback),
    },
  });
  type VueErrorHandler = (reason: unknown, instance: unknown, context: string) => void;
  const { installErrorLogging } = evaluateSource<{
    installErrorLogging: (app: { config: { errorHandler?: VueErrorHandler } }) => void;
  }>(output, { "@/shared/logging/logger": { logger } });
  const app: { config: { errorHandler?: VueErrorHandler } } = { config: {} };
  installErrorLogging(app);
  app.config.errorHandler?.(new Error("render failed"), null, "render function");
  listeners.get("error")?.({ error: new Error("uncaught") });
  listeners.get("unhandledrejection")?.({ reason: { lyrics: "private", response: "secret" } });
  expect(records.map((record) => record.event)).toEqual([
    "frontend_started",
    "unhandled_error",
    "uncaught_error",
    "unhandled_rejection",
  ]);
  expect(records[1]?.context).toBe("render function");
  expect(records[2]?.error).toBe("uncaught");
  expect(records[3]?.error).toBe("Unknown error");
  expect(JSON.stringify(records)).not.toContain("secret");
});
